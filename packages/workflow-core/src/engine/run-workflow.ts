import { LogConflictError, StepTimeoutError } from '../types'
import { diffState, snapshotState } from './state-diff'
import { fingerprintWorkflow } from './fingerprint'
import {
  approvalRequestedEvent,
  customEvent,
  runErrorEvent,
  runFinishedEvent,
  runStartedEvent,
  stateDeltaEvent,
  stateSnapshotEvent,
  stepFinishedEvent,
  stepStartedEvent,
} from './emit-events'
import type {
  AnyWorkflowDefinition,
  ApprovalResult,
  LiveRun,
  RunState,
  RunStore,
  SignalResult,
  StepDescriptor,
  StepRecord,
  StepRetryOptions,
  WorkflowEvent,
  WorkflowRunArgs,
} from '../types'
import type { InMemoryRunStore } from '../run-store/in-memory'

/**
 * Narrow a generic `RunStore` to one with the in-process live-handle
 * methods (`setLive` / `getLive`). Durable stores skip these and the
 * engine falls back to the replay path.
 */
function asLiveStore(store: RunStore): InMemoryRunStore | undefined {
  const candidate = store as Partial<InMemoryRunStore>
  if (
    typeof candidate.setLive === 'function' &&
    typeof candidate.getLive === 'function'
  ) {
    return candidate as InMemoryRunStore
  }
  return undefined
}

export interface RunWorkflowOptions {
  workflow: AnyWorkflowDefinition
  /**
   * Run state and step-log store. `InMemoryRunStore` adds an in-process
   * live-generator cache (`setLive`/`getLive`) for the same-node fast
   * path; durable `RunStore` implementations omit those and the engine
   * falls back to the replay path.
   */
  runStore: RunStore
  /** First-call: provide `input`. Resume-call: provide `runId` + either
   *  `approval` (legacy) or `signalDelivery` (generic). Attach-call:
   *  provide `runId` + `attach: true`. */
  input?: unknown
  runId?: string
  approval?: ApprovalResult
  /**
   * Generic signal delivery. Resumes a run paused on
   * `waitForSignal(name)` by delivering `payload` as the yield's
   * value. `signalId` is the host's idempotency token for this
   * delivery. When both `approval` and `signalDelivery` are provided,
   * `signalDelivery` wins — `approval` is retained as a typed wrapper
   * for the '__approval' signal.
   */
  signalDelivery?: SignalResult
  /**
   * Attach to an existing run. Synthesizes RUN_STARTED +
   * STATE_SNAPSHOT + `steps-snapshot` from the persisted log so a
   * fresh subscriber (browser tab refresh, shared link, mobile
   * reconnect) can rebuild its UI from scratch. After the snapshot:
   *   - paused runs: emit run.paused and end the stream
   *   - finished/errored runs: emit RUN_FINISHED/RUN_ERROR and end
   *   - in-process running runs: tail the live event stream (the host
   *     ran the original start/resume on the same node)
   *   - cross-node running runs: emit a final status hint and end —
   *     hosts that need cross-node tailing wire the publisher hook
   *     and subscribe to it themselves
   */
  attach?: boolean
  /** Optional: external abort signal. */
  signal?: AbortSignal
  /** Optional: thread ID for client-side correlation. */
  threadId?: string
  /**
   * Optional: called with the workflow's final output value before the
   * store entry is deleted. Used by the parent engine to capture
   * nested-workflow output across the store-delete boundary.
   */
  outputSink?: (output: unknown) => void
  /**
   * Optional event publisher hook. Called once per event emitted by
   * the engine, before the event is yielded to the stream consumer.
   * Hosts wire this to a fan-out transport (Redis pub/sub, NATS,
   * EventBridge, etc.) so attached subscribers on *other* nodes can
   * tail live events. Errors thrown by `publish` are caught and
   * swallowed — a misbehaving publisher must not break the run.
   *
   * Single-node deployments can ignore this. Multi-node deployments
   * use it as the seam where the library doesn't ship transport.
   */
  publish?: (runId: string, event: WorkflowEvent) => void | Promise<void>
}

// ----- helpers -----

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function mergeStateDefaults(
  workflow: AnyWorkflowDefinition,
  initial: Record<string, unknown>,
): Record<string, unknown> {
  if (!workflow.stateSchema) return initial
  const validated = workflow.stateSchema['~standard'].validate(initial)
  // Async validation isn't supported on this code path — making it
  // async would mean every run-start became async-deep, which is
  // out of scope for v1. We fail loud rather than silently bypassing
  // the schema.
  if (validated instanceof Promise) {
    throw new Error(
      `Workflow "${workflow.name}" state schema validates asynchronously, which is not supported. State schemas must validate synchronously.`,
    )
  }
  if (validated.issues) {
    const summary = (validated.issues as ReadonlyArray<unknown>)
      .map((iss) => {
        const issue = iss as { message?: string; path?: ReadonlyArray<unknown> }
        const where = issue.path?.length ? ` at ${issue.path.join('.')}` : ''
        return `${issue.message ?? 'invalid'}${where}`
      })
      .join('; ')
    throw new Error(
      `Workflow "${workflow.name}" initial state failed schema validation: ${summary}`,
    )
  }
  return validated.value as Record<string, unknown>
}

function serializeError(err: unknown): {
  name: string
  message: string
  stack?: string
} {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack }
  }
  return { name: 'UnknownError', message: String(err) }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Compute the wait between retry attempts. `attempt` is the *just-
 * failed* attempt number (1-indexed), so the next attempt happens
 * after `delay(attempt)` ms.
 */
function computeBackoffMs(
  policy: StepRetryOptions | undefined,
  attempt: number,
): number {
  if (!policy) return 0
  const base = policy.baseMs ?? 500
  if (typeof policy.backoff === 'function') return policy.backoff(attempt)
  if (policy.backoff === 'fixed') return base
  // Default: exponential. attempt=1 -> base, attempt=2 -> base*2, …
  return base * 2 ** (attempt - 1)
}

/**
 * Reconstruct the initial state for a workflow. Used both on start
 * (fresh run) and on replay-from-store resume (recover state from
 * scratch by re-running `initialize` + re-applying user-code mutations
 * via replay).
 *
 * Replay determinism relies on this returning the same shape every
 * time for a given input — `initialize` should be pure given its
 * arguments.
 */
function buildInitialState(
  workflow: AnyWorkflowDefinition,
  input: unknown,
): Record<string, unknown> {
  const initial = workflow.initialize
    ? workflow.initialize({ input: input })
    : {}
  return mergeStateDefaults(workflow, initial)
}

/**
 * Run a workflow to completion or pause point (start or resume).
 * Returns an `AsyncIterable<WorkflowEvent>` that the caller pipes to
 * SSE / a local subscriber / a fan-out transport.
 *
 * - Start call: provide `workflow`, `input`, and `runStore`.
 * - Resume call: provide `workflow`, `runId`, `approval` (or
 *   `signalDelivery`), and `runStore`.
 *
 * Pause semantics: when user code yields an `approval` or `signal`
 * descriptor, the engine emits the corresponding event, persists run
 * state, stores the live generator handle in `runStore.setLive`, then
 * ends the stream. The host resumes by calling `runWorkflow` again
 * with `runId` and the matching delivery.
 *
 * Durability: every completed step is appended to the run's step log
 * via `runStore.appendStep` *before* the corresponding STEP_FINISHED
 * is emitted (at-most-once observable). On resume, if the live
 * generator is gone (process restart, multi-instance routing), the
 * engine reconstructs by reading the log and replaying user code,
 * short-circuiting each yielded descriptor with its recorded result.
 */
export async function* runWorkflow(
  options: RunWorkflowOptions,
): AsyncIterable<WorkflowEvent> {
  // Inner generator does the actual work; the outer wrapper intercepts
  // every event so the publisher hook sees every emission before the
  // stream consumer does. We track the runId as it emerges from
  // RUN_STARTED so the publish callback always carries the right key
  // (start-paths don't know the runId at construction time).
  async function* inner(): AsyncIterable<WorkflowEvent> {
    if (options.runId && options.attach) {
      yield* attachRun(options)
      return
    }
    if (options.runId && (options.approval || options.signalDelivery)) {
      yield* resumeRun(options)
      return
    }
    if (options.input === undefined) {
      throw new Error(
        'runWorkflow: provide `input` (start), `runId` + `approval`/`signalDelivery` (resume), or `runId` + `attach: true` (attach)',
      )
    }
    yield* startRun(options as RunWorkflowOptions & { input: unknown })
  }

  let knownRunId = options.runId
  for await (const event of inner()) {
    if (event.type === 'RUN_STARTED' && !knownRunId) {
      knownRunId = event.runId
    }
    if (options.publish && knownRunId) {
      try {
        await options.publish(knownRunId, event)
      } catch {
        // Swallow — a misbehaving publisher must not break the run.
      }
    }
    yield event
  }
}

async function* startRun(
  options: RunWorkflowOptions & { input: unknown },
): AsyncIterable<WorkflowEvent> {
  const runId = options.runId ?? generateId('run')
  const fingerprint = fingerprintWorkflow(options.workflow)

  // Idempotency check: if the client provided a runId and a run already
  // exists with that id, either treat this call as a retry (the
  // fingerprint matches → the original start succeeded; we deliver an
  // attach snapshot so the caller sees the run as it stands), or reject
  // with RUN_ID_CONFLICT (the fingerprint doesn't match — most likely a
  // collision rather than a true retry). Generated runIds skip this
  // check because their probabilistic collision rate is negligible.
  if (options.runId) {
    const existing = await options.runStore.getRunState(runId)
    if (existing) {
      // Three-way fingerprint check:
      //   - Both fingerprints present and match → idempotent retry.
      //   - Both fingerprints present and differ → run_id_conflict.
      //   - Persisted fingerprint missing (legacy or torn write) →
      //     can't prove equality, treat as a conflict to fail loud
      //     rather than silently serving a possibly-incompatible
      //     attach snapshot.
      if (!existing.fingerprint || existing.fingerprint !== fingerprint) {
        yield runErrorEvent({
          runId,
          message: existing.fingerprint
            ? `Run id "${runId}" already exists with a different workflow fingerprint (${existing.fingerprint} vs ${fingerprint}). Generate a fresh runId or use \`attach: true\` to read the existing run.`
            : `Run id "${runId}" already exists but its persisted state has no fingerprint (legacy or torn write); cannot verify workflow identity. Use \`attach: true\` explicitly or generate a fresh runId.`,
          code: 'run_id_conflict',
        })
        return
      }
      // Same runId, same fingerprint → idempotent retry. Serve the
      // current state via the attach path so callers always get a
      // consistent envelope of events regardless of whether they hit
      // a fresh start or a retry.
      yield* attachRun({ ...options, attach: true })
      return
    }
  }

  const abortController = new AbortController()
  if (options.signal) {
    // Honor a signal that's already aborted before runWorkflow was called —
    // addEventListener('abort') is not invoked for the already-aborted state,
    // which would otherwise let a pre-cancelled caller proceed past start.
    if (options.signal.aborted) abortController.abort()
    else
      options.signal.addEventListener('abort', () => abortController.abort(), {
        once: true,
      })
  }

  const state = buildInitialState(options.workflow, options.input)

  const runState: RunState = {
    runId,
    status: 'running',
    workflowName: options.workflow.name,
    workflowVersion: options.workflow.version,
    fingerprint,
    startingPatches: options.workflow.patches
      ? [...options.workflow.patches]
      : undefined,
    input: options.input,
    state,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await options.runStore.setRunState(runId, runState)

  yield runStartedEvent({ runId, threadId: options.threadId })
  yield stateSnapshotEvent({ snapshot: state })

  const live: LiveRun = {
    runState,
     
    generator: undefined as unknown as LiveRun['generator'],
    abortController,
    approvalResolver: undefined,
    pendingEvents: [],
  }

  const args: WorkflowRunArgs<unknown, unknown> = {
    input: options.input,
    state,
    emit: (name, value) => {
      live.pendingEvents.push({
        type: 'CUSTOM',
        timestamp: Date.now(),
        name,
        value,
      })
    },
    signal: abortController.signal,
  }

  const generator = options.workflow.run(args)
  live.generator = generator
  asLiveStore(options.runStore)?.setLive(runId, live)

  yield* driveLoop({
    live,
    runId,
    state,
    runStore: options.runStore,
    threadId: options.threadId,
    outputSink: options.outputSink,
    abortController,
    seedValue: undefined,
    hasSeed: false,
    replayLog: [],
    workflow: options.workflow,
    publish: options.publish,
  })
}

/**
 * Read-only subscribe to an existing run.
 *
 * Emits a synthetic snapshot package — RUN_STARTED + STATE_SNAPSHOT +
 * `steps-snapshot` (CUSTOM with all completed step records) — so a
 * fresh subscriber can rebuild its UI without needing per-token
 * streaming history. After the snapshot:
 *   - finished/errored runs emit the terminal event and end.
 *   - paused runs emit `run.paused` and end.
 *   - in-process running runs end with a status hint; cross-node
 *     tailing requires the publisher hook.
 */
async function* attachRun(
  options: RunWorkflowOptions,
): AsyncIterable<WorkflowEvent> {
  const runId = options.runId!
  const persistedRunState = await options.runStore.getRunState(runId)
  if (!persistedRunState) {
    yield runErrorEvent({
      runId,
      message: `Run ${runId} not found (expired or never existed)`,
      code: 'run_lost',
    })
    return
  }

  // Surface RUN_STARTED so clients always see a consistent stream
  // opener, regardless of whether they're starting / resuming /
  // attaching. The runId on the event matches the persisted one.
  yield runStartedEvent({ runId, threadId: options.threadId })
  yield stateSnapshotEvent({ snapshot: persistedRunState.state })

  // STEPS_SNAPSHOT is a single CUSTOM event carrying all completed
  // step records so the client can rebuild its timeline from scratch.
  const steps = await options.runStore.getSteps(runId)
  yield customEvent({
    name: 'steps-snapshot',
    value: {
      steps: steps.map((r) => ({
        index: r.index,
        kind: r.kind,
        name: r.name,
        result: r.result,
        error: r.error,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
      })),
    },
  })

  if (persistedRunState.status === 'finished') {
    yield runFinishedEvent({
      runId,
      threadId: options.threadId,
      output: persistedRunState.output,
    })
    return
  }
  if (
    persistedRunState.status === 'error' ||
    persistedRunState.status === 'aborted'
  ) {
    yield runErrorEvent({
      runId,
      message:
        persistedRunState.error?.message ??
        `Run ${runId} ended with status ${persistedRunState.status}`,
      code: persistedRunState.status === 'aborted' ? 'aborted' : 'error',
    })
    return
  }
  if (persistedRunState.status === 'paused') {
    // Re-emit the pause notice so the attaching client knows what to
    // wake the run with. The originating stream already emitted this
    // on the prior connection — this subscriber didn't see that.
    yield customEvent({
      name: 'run.paused',
      value: {
        runId,
        signalName:
          persistedRunState.waitingFor?.signalName ??
          (persistedRunState.pendingApproval ? '__approval' : 'unknown'),
        deadline: persistedRunState.waitingFor?.deadline,
        kind: persistedRunState.pendingApproval
          ? 'approval'
          : persistedRunState.waitingFor?.signalName === '__timer'
            ? 'sleep'
            : 'signal',
        meta:
          persistedRunState.waitingFor?.meta ??
          (persistedRunState.pendingApproval
            ? {
                title: persistedRunState.pendingApproval.title,
                description: persistedRunState.pendingApproval.description,
              }
            : undefined),
      },
    })
    // For approval pauses, also surface `approval-requested` so the
    // attaching client's existing handler populates `pendingApproval`.
    if (persistedRunState.pendingApproval) {
      yield approvalRequestedEvent({
        approvalId: persistedRunState.pendingApproval.approvalId,
        title: persistedRunState.pendingApproval.title,
        description: persistedRunState.pendingApproval.description,
      })
    }
    return
  }

  // status === 'running'. We can only tail if the executing generator
  // lives in this process. Cross-node attach lands when the publisher
  // hook is wired — for v1 single-node, the snapshot above is the
  // useful payload and we end the stream.
  yield customEvent({
    name: 'run.current-status',
    value: {
      runId,
      status: 'running',
      note: 'Run is executing on another node (or this process is read-only). Wire the publisher hook to tail live events.',
    },
  })
}

async function* resumeRun(
  options: RunWorkflowOptions,
): AsyncIterable<WorkflowEvent> {
  const runId = options.runId!
  // `signalDelivery` is the generic path; `approval` remains as a
  // typed shorthand for the '__approval' descriptor that `approve()`
  // yields. Either resolves the pending pause — they're never both
  // meaningful, and signalDelivery wins when both are passed.
  const seedPayload: unknown =
    options.signalDelivery !== undefined
      ? options.signalDelivery.payload
      : options.approval
  // A resume call IS a seed delivery, even when the payload is
  // intentionally `undefined` (timer wakes, void-returning signals).
  // Bucketing this by "did the caller supply a delivery?" rather than
  // "is the payload truthy?" is what prevents sleep wakes from
  // silently re-pausing on the replay path.
  const hasSeed =
    options.signalDelivery !== undefined || options.approval !== undefined

  // Fast path: live generator still in process (same node, no
  // restart). Only available on stores that implement `getLive` (the
  // in-memory store); durable stores skip this and the replay path is
  // the only resume path.
  const inMemory = asLiveStore(options.runStore)?.getLive(runId)
  if (inMemory) {
    inMemory.runState = {
      ...inMemory.runState,
      status: 'running',
      updatedAt: Date.now(),
    }
    await options.runStore.setRunState(runId, inMemory.runState)

    yield runStartedEvent({ runId, threadId: options.threadId })

    yield* driveLoop({
      live: inMemory,
      runId,
      state: inMemory.runState.state as Record<string, unknown>,
      runStore: options.runStore,
      threadId: options.threadId,
      outputSink: options.outputSink,
      abortController: inMemory.abortController,
      seedValue: seedPayload,
      hasSeed,
      seedSignalId: options.signalDelivery?.signalId,
      replayLog: [],
      workflow: options.workflow,
      publish: options.publish,
    })
    return
  }

  // Replay path: live generator is gone (process restart, multi-node
  // routing). Reconstruct by loading state + log from the store, re-
  // running the workflow from scratch, short-circuiting each yielded
  // step with its recorded log entry.
  const persistedRunState = await options.runStore.getRunState(runId)
  if (!persistedRunState) {
    yield runErrorEvent({
      runId,
      message: `Run ${runId} not found (expired or never existed)`,
      code: 'run_lost',
    })
    return
  }

  // Workflow source fingerprint guard. Two modes:
  //
  //   Strict mode (no workflow.patches declared):
  //     The fingerprint covers the workflow's full source. Any drift
  //     refuses resume with workflow_version_mismatch. Recovery is
  //     drain-then-deploy.
  //
  //   Patch-versioned mode (workflow.patches declared):
  //     The fingerprint covers only name + sorted patch list. The
  //     run's recorded startingPatches must be a SUBSET of the
  //     current workflow's patches — we can add patches across
  //     deploys without invalidating in-flight runs, but we can't
  //     remove patches (a run started with patch X gating its old
  //     path would lose the path entirely on resume).
  const currentFingerprint = fingerprintWorkflow(options.workflow)
  if (options.workflow.patches !== undefined) {
    const currentSet = new Set(options.workflow.patches)
    const runPatches = persistedRunState.startingPatches ?? []
    const missing = runPatches.filter((p) => !currentSet.has(p))
    if (missing.length > 0) {
      yield runErrorEvent({
        runId,
        message: `Workflow lost patches ${missing.join(', ')} since run ${runId} was started. Patches can be added across deploys, not removed while runs are in flight.`,
        code: 'workflow_patches_removed',
      })
      return
    }
  } else if (
    persistedRunState.fingerprint &&
    persistedRunState.fingerprint !== currentFingerprint
  ) {
    yield runErrorEvent({
      runId,
      message: `Workflow source changed since run ${runId} was started (fingerprint ${persistedRunState.fingerprint} -> ${currentFingerprint}). Refusing resume. Declare \`patches\` on the workflow to opt into patch-versioned migration.`,
      code: 'workflow_version_mismatch',
    })
    return
  }

  const replayLog = await options.runStore.getSteps(runId)

  // Rebuild fresh state. The persisted snapshot would otherwise
  // compound with the re-execution of user-code state mutations —
  // replay restores state authoritatively by re-running the workflow
  // from initial state against the log. Determinism contract:
  // `initialize` is pure.
  const state = buildInitialState(options.workflow, persistedRunState.input)

  const abortController = new AbortController()
  if (options.signal) {
    if (options.signal.aborted) abortController.abort()
    else
      options.signal.addEventListener('abort', () => abortController.abort(), {
        once: true,
      })
  }

  const live: LiveRun = {
    runState: {
      ...persistedRunState,
      status: 'running',
      updatedAt: Date.now(),
    },
     
    generator: undefined as unknown as LiveRun['generator'],
    abortController,
    approvalResolver: undefined,
    pendingEvents: [],
  }

  const args: WorkflowRunArgs<unknown, unknown> = {
    input: persistedRunState.input,
    state,
    emit: (name, value) => {
      live.pendingEvents.push({
        type: 'CUSTOM',
        timestamp: Date.now(),
        name,
        value,
      })
    },
    signal: abortController.signal,
  }

  const generator = options.workflow.run(args)
  live.generator = generator
  asLiveStore(options.runStore)?.setLive(runId, live)
  await options.runStore.setRunState(runId, live.runState)

  yield runStartedEvent({ runId, threadId: options.threadId })

  yield* driveLoop({
    live,
    runId,
    state,
    runStore: options.runStore,
    threadId: options.threadId,
    outputSink: options.outputSink,
    abortController,
    seedValue: seedPayload,
    hasSeed,
    seedSignalId: options.signalDelivery?.signalId,
    replayLog,
    workflow: options.workflow,
    publish: options.publish,
  })
}

interface DriveLoopArgs {
  live: LiveRun
  runId: string
  /** Same reference the user generator's `args.state` holds. */
  state: Record<string, unknown>
  runStore: RunStore
  threadId?: string
  outputSink?: (output: unknown) => void
  abortController: AbortController
  /** Publisher hook plumbed from the top-level runWorkflow call, so
   *  nested workflows can fan out events to the same transport under
   *  their own runId. Without this, attached subscribers on other
   *  nodes never see nested-run events. */
  publish?: (runId: string, event: WorkflowEvent) => void | Promise<void>
  /**
   * Value to send into the *post-replay* `generator.next(...)`. For
   * start, undefined. For resume, the seed delivery's payload. Replay
   * itself ignores it; it's consumed exactly once to satisfy the
   * descriptor that was awaiting when the run paused.
   */
  seedValue: unknown
  /**
   * Whether a seed is being delivered on this call. Distinguishes
   * "resume call with `payload: undefined`" (a valid delivery for
   * void-returning signals like sleep / `waitForSignal<void>`) from
   * "start call with no seed at all".
   */
  hasSeed: boolean
  /** Idempotency token for the seed delivery. Recorded on the
   *  resulting approval/signal step record so a subsequent retry with
   *  the same signalId can be deduped to the existing entry. */
  seedSignalId?: string
  /**
   * Recorded step results from a prior run instance. Empty for fresh
   * starts and in-memory resumes. Non-empty for replay-after-restart:
   * each entry short-circuits the next yielded descriptor without
   * dispatching the work again. Entries are positionally indexed
   * (cursor 0 = first yield).
   */
  replayLog: ReadonlyArray<StepRecord>
  workflow: AnyWorkflowDefinition
}

/**
 * Shared dispatch loop for start, resume-from-memory, and resume-from-
 * replay paths. Drives the generator, dispatches descriptor kinds,
 * persists step results, emits state deltas, and finalizes the run on
 * done / error / abort / pause.
 *
 * Replay phase (silent fast-forward):
 *   For the first `replayLog.length` yields, return the recorded
 *   result without dispatching or emitting client-facing events.
 *   State mutations during user code re-execute and are tracked
 *   locally so the next live-mode mutation diff is correct.
 *
 * Live phase:
 *   The next yielded descriptor is what was awaiting at pause time
 *   (for resume) or the first step (for start). The seed value, if
 *   any, is consumed exactly once as the result for that descriptor —
 *   typically an approval/signal — and the engine appends a fresh log
 *   entry capturing it. Subsequent yields dispatch normally; each
 *   completed step is appended to the log before its STEP_FINISHED
 *   event reaches the client (at-most-once observable).
 */
async function* driveLoop(
  args: DriveLoopArgs,
): AsyncIterable<WorkflowEvent> {
  const {
    live,
    runId,
    state,
    runStore,
    threadId,
    outputSink,
    abortController,
    replayLog,
  } = args

  let prevState = snapshotState(state)
  // Track an outstanding approval pause that was emitted in a *prior*
  // stream response (the run paused, the stream ended). On the in-
  // memory resume path we close that dangling STEP_STARTED by emitting
  // a matching STEP_FINISHED below; on the replay path it's already
  // gone (we built a fresh LiveRun) so this is undefined and we emit a
  // fresh pair on the consumed approval.
  const pendingApprovalStepId = live.pendingApprovalStepId
  live.pendingApprovalStepId = undefined

  // Differentiate the three entry conditions so the initial
  // generator.next() arg and the seed-consumption flag are set right:
  //
  //   start path           — generator hasn't yielded yet, no seed
  //                          → next(undefined), seedConsumed=true
  //   in-memory resume     — generator yielded the pause before the
  //                          last stream closed; seed is the result
  //                          for *that* outstanding yield
  //                          → next(seed), seedConsumed=true
  //   replay resume        — fresh generator; replay drives it forward
  //                          step-by-step; seed gets consumed when we
  //                          reach the descriptor that has no log entry
  //                          → next(undefined), seedConsumed=false
  const isInMemoryResume = !!pendingApprovalStepId
  let nextValue: unknown = isInMemoryResume ? args.seedValue : undefined
  // seedConsumed flips false when the caller supplied a real delivery
  // (signalDelivery / approval) AND we still need to apply it to the
  // post-replay pause descriptor. The in-memory fast path consumes
  // the seed implicitly via the dangling-step closure block below, so
  // it starts already-consumed.
  let seedConsumed = !args.hasSeed || isInMemoryResume
  let replayCursor = 0
  // Tracks the next position in the persisted log we'll append to.
  // Starts at `replayLog.length` because we never overwrite replayed
  // entries.
  let logLength = replayLog.length
  let finalOutput: unknown = undefined

  try {
    if (pendingApprovalStepId && replayLog.length === 0) {
      // In-memory resume: the previous run handler already emitted
      // STEP_STARTED for this pause before the stream closed; close
      // it out now. For the legacy 'approval' descriptor we marshal
      // the payload into the original {approved, feedback} envelope
      // so existing UI consumers don't break; for generic signals we
      // forward the payload as-is.
      //
      // Persist the resolved signal/approval to the log *before*
      // emitting STEP_FINISHED. This is what lets a future attach
      // call replay through the resolved pause; without it, the in-
      // memory fast-path silently skipped the log append and the
      // next replay would re-enter the pause.
      const waitingFor = live.runState.waitingFor
      const seed = args.seedValue
      // Approval pauses set `pendingApproval` but NOT `waitingFor`,
      // so the absence of `waitingFor` is the canonical "this was an
      // approve()" marker. The signalName check uses the reserved
      // sentinel `__approval` so a user-named
      // `waitForSignal('approval', ...)` is not accidentally treated
      // as an approval pause.
      const isApproval = !waitingFor || waitingFor.signalName === '__approval'
      const content = isApproval
        ? {
            approved: (seed as ApprovalResult | undefined)?.approved ?? false,
            feedback: (seed as ApprovalResult | undefined)?.feedback,
          }
        : seed
      const inMemAppend = await tryAppendStep(runStore, runId, logLength, {
        index: logLength,
        kind: isApproval ? 'approval' : 'signal',
        name: waitingFor?.signalName ?? 'approval',
        signalId: args.seedSignalId,
        result: isApproval ? seed : content,
        startedAt: Date.now(),
        finishedAt: Date.now(),
      })
      if (inMemAppend.kind === 'lost') {
        // Another delivery won the race — this caller's signal had
        // no effect. Surface so the host knows to either retry with a
        // different signalId or stand down. Restore status to 'paused'
        // because the live generator is still parked on the original
        // pause; the losing caller's resume just stops driving it.
        live.runState.status = 'paused'
        live.runState.updatedAt = Date.now()
        await runStore.setRunState(runId, live.runState)
        yield runErrorEvent({
          runId,
          message: `Signal lost at index ${logLength}: another delivery won the race (winning signalId: ${inMemAppend.existing.signalId ?? '(unsigned)'}).`,
          code: 'signal_lost',
        })
        return
      }
      // Idempotent: same signalId, the prior delivery's record stands.
      // We still emit STEP_FINISHED so the caller sees a coherent end,
      // but the emitted content reflects the EXISTING recorded result,
      // not the caller's retry payload. Two callers delivering the
      // same signalId with different payloads must both observe the
      // authoritative first-write — otherwise the second caller's UI
      // shows a different value than the workflow's own state. We
      // also override `nextValue` so the generator resumes with the
      // recorded result; sending the caller's payload would advance
      // the workflow along a divergent path.
      if (inMemAppend.kind === 'idempotent') {
        nextValue = inMemAppend.existing.result
      }
      const idempotentContent =
        inMemAppend.kind === 'idempotent'
          ? inMemAppend.existing.result
          : content
      logLength++
      yield stepFinishedEvent({
        stepId: pendingApprovalStepId,
        stepName: waitingFor?.signalName ?? 'approval',
        content: idempotentContent,
      })
    }

    // `pendingResult` is set by the error path: `generator.throw()`
    // already advances the generator to the next yield, so we must NOT
    // call `.next()` again in the next loop iteration. Stashing the
    // throw's return value here lets the next iteration use it
    // directly.
    let pendingResult: IteratorResult<StepDescriptor, unknown> | null = null

    for (;;) {
      const isReplaying = replayCursor < replayLog.length

      // Drain custom events only in live mode — events emitted during
      // replay are recorded in pendingEvents but never reach the wire,
      // since the original run already emitted them.
      if (!isReplaying) {
        while (live.pendingEvents.length > 0) yield live.pendingEvents.shift()!
      } else {
        // Discard pending events accumulated during the prior
        // generator step — they were already emitted on the original
        // run.
        live.pendingEvents.length = 0
      }

      const result =
        pendingResult ??
        (await live.generator.next(nextValue))
      pendingResult = null

      // Track state diffs every iteration so the local prevState stays
      // in sync, but only emit STATE_DELTA in live mode.
      const delta = diffState(prevState, state)
      if (delta.length > 0) {
        prevState = snapshotState(state)
        if (!isReplaying) yield stateDeltaEvent({ delta })
      }

      if (result.done) {
        finalOutput = result.value
        break
      }

      const descriptor: StepDescriptor = result.value

      // Replay short-circuit: log entry exists for this position. For
      // successful records we simply hand the result back to the
      // generator. For records that captured a throw, we reconstruct
      // the Error and re-throw it into the generator so user-side
      // try/catch logic replays identically.
      if (replayCursor < replayLog.length) {
        const record = replayLog[replayCursor]!
        replayCursor++
        if (record.error) {
          const err = new Error(record.error.message)
          err.name = record.error.name
          if (record.error.stack) err.stack = record.error.stack
          const thrown = await live.generator.throw(err)
          if (thrown.done) {
            finalOutput = thrown.value
            break
          }
          pendingResult = thrown
          continue
        }
        nextValue = record.result
        continue
      }

      const stepId = generateId('step')

      // Post-replay seed delivery: the seed value is the result for
      // the descriptor that was awaiting when the run originally
      // paused. Record it as a fresh log entry and emit synthetic
      // STEP_STARTED+STEP_FINISHED events so the consumer of this
      // resume stream sees the closure.
      //
      // If the post-replay descriptor isn't a pause kind, the seed is
      // for a LATER descriptor — typically because deterministic
      // primitives (patched, now, uuid) don't write to the log, so
      // they re-yield on replay even though we have a seed waiting.
      // Fall through to normal live dispatch; the seed stays
      // unconsumed until we hit the actual pause descriptor.
      if (
        !seedConsumed &&
        (descriptor.kind === 'approval' || descriptor.kind === 'signal')
      ) {
        seedConsumed = true
        const sigName =
          descriptor.kind === 'approval' ? 'approval' : descriptor.name
        yield stepStartedEvent({
          stepId,
          stepName: sigName,
          stepType: descriptor.kind === 'approval' ? 'approval' : 'signal',
        })
        const outcome = await tryAppendStep(runStore, runId, logLength, {
          index: logLength,
          kind: descriptor.kind === 'approval' ? 'approval' : 'signal',
          name: sigName,
          signalId: args.seedSignalId,
          result: args.seedValue,
          startedAt: Date.now(),
          finishedAt: Date.now(),
        })
        if (outcome.kind === 'lost') {
          // Same as the in-memory branch: restore status so the next
          // resume attempt sees an accurate 'paused' state rather than
          // a stale 'running'.
          live.runState.status = 'paused'
          live.runState.updatedAt = Date.now()
          await runStore.setRunState(runId, live.runState)
          yield runErrorEvent({
            runId,
            message: `Signal lost at index ${logLength}: another delivery won the race (winning signalId: ${outcome.existing.signalId ?? '(unsigned)'}).`,
            code: 'signal_lost',
          })
          return
        }
        // For 'idempotent', the existing record's result becomes the
        // value sent into the generator instead of our incoming
        // seedValue — this is the retry-dedup path. Both callers
        // observe the same downstream behavior.
        const seedResult =
          outcome.kind === 'idempotent'
            ? outcome.existing.result
            : args.seedValue
        logLength++
        yield stepFinishedEvent({
          stepId,
          stepName: sigName,
          content: seedResult,
        })
        nextValue = seedResult
        continue
      }

      // ---- step (durable side-effect) ----
      if (descriptor.kind === 'step') {
        const overallStart = Date.now()
        yield stepStartedEvent({
          stepId,
          stepName: descriptor.name,
          stepType: 'step',
        })

        const ctxId = `${runId}:step-${logLength}`
        const retryPolicy = descriptor.retry ?? args.workflow.defaultStepRetry
        const maxAttempts = Math.max(1, retryPolicy?.maxAttempts ?? 1)
        const attempts: Array<{
          startedAt: number
          finishedAt: number
          error?: { name: string; message: string; stack?: string }
          result?: unknown
        }> = []
        let lastError: unknown
        let stepResult: unknown
        let succeeded = false

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          const attemptStart = Date.now()

          // Per-attempt AbortController. Aborts on:
          //   - the run's overall AbortController (Ctrl+C / stop)
          //   - the step's timeout firing (if set)
          const attemptController = new AbortController()
          // addEventListener('abort', ...) doesn't fire for an already-
          // aborted signal — eagerly propagate so step fns see the
          // pre-aborted state on ctx.signal.aborted on the first attempt.
          if (abortController.signal.aborted) attemptController.abort()
          const onParentAbort = () => attemptController.abort()
          abortController.signal.addEventListener('abort', onParentAbort, {
            once: true,
          })
          let timeoutHandle: ReturnType<typeof setTimeout> | null = null
          // Track the abort cause explicitly so the abort listener
          // can distinguish a parent-run abort from a timeout — the
          // previous `!timeoutHandle` proxy was always truthy once
          // setTimeout had assigned, which mis-classified run-level
          // aborts as timeouts.
          let timedOut = false
          if (descriptor.timeout && descriptor.timeout > 0) {
            timeoutHandle = setTimeout(() => {
              timedOut = true
              attemptController.abort()
            }, descriptor.timeout)
          }

          try {
            const fnPromise = Promise.resolve(
              descriptor.fn({
                id: ctxId,
                attempt,
                signal: attemptController.signal,
              }),
            )
            // Race the user fn against a timeout-driven rejection so
            // unresponsive code (e.g., a fetch that ignores the
            // AbortSignal) still surfaces as a StepTimeoutError rather
            // than hanging forever.
            stepResult = descriptor.timeout
              ? await Promise.race([
                  fnPromise,
                  new Promise<never>((_, reject) => {
                    attemptController.signal.addEventListener(
                      'abort',
                      () => {
                        if (!timedOut && abortController.signal.aborted) {
                          // Aborted by run-level cancel, not by timeout.
                          reject(new Error('Workflow aborted'))
                          return
                        }
                        reject(
                          new StepTimeoutError(
                            descriptor.name,
                            descriptor.timeout!,
                          ),
                        )
                      },
                      { once: true },
                    )
                  }),
                ])
              : await fnPromise
            attempts.push({
              startedAt: attemptStart,
              finishedAt: Date.now(),
              result: stepResult,
            })
            succeeded = true
            if (timeoutHandle) clearTimeout(timeoutHandle)
            abortController.signal.removeEventListener('abort', onParentAbort)
            break
          } catch (err) {
            if (timeoutHandle) clearTimeout(timeoutHandle)
            abortController.signal.removeEventListener('abort', onParentAbort)
            lastError = err
            attempts.push({
              startedAt: attemptStart,
              finishedAt: Date.now(),
              error: serializeError(err),
            })
            const shouldRetry =
              attempt < maxAttempts &&
              (retryPolicy?.shouldRetry?.(err, attempt) ?? true)
            if (!shouldRetry) break
            // In-process backoff. Durable across yields, not durable
            // across process restart — an acceptable v1 limitation.
            // Long-tail retries that need full durability should use
            // `yield* sleep(...)` in user code instead.
            const delayMs = computeBackoffMs(retryPolicy, attempt)
            if (delayMs > 0) {
              await new Promise<void>((resolve) => {
                const t = setTimeout(resolve, delayMs)
                // Abort cleanly if the run is cancelled mid-backoff.
                abortController.signal.addEventListener(
                  'abort',
                  () => {
                    clearTimeout(t)
                    resolve()
                  },
                  { once: true },
                )
              })
              if (abortController.signal.aborted) break
            }
          }
        }

        if (!succeeded) {
          await appendStep(runStore, runId, logLength, {
            index: logLength,
            kind: 'step',
            name: descriptor.name,
            error: serializeError(lastError),
            attempts,
            startedAt: overallStart,
            finishedAt: Date.now(),
          })
          logLength++
          yield stepFinishedEvent({
            stepId,
            stepName: descriptor.name,
            content: { error: serializeError(lastError) },
          })
          nextValue = undefined
          const thrown = await live.generator.throw(lastError)
          if (thrown.done) {
            finalOutput = thrown.value
            break
          }
          pendingResult = thrown
          continue
        }

        await appendStep(runStore, runId, logLength, {
          index: logLength,
          kind: 'step',
          name: descriptor.name,
          result: stepResult,
          attempts: attempts.length > 1 ? attempts : undefined,
          startedAt: overallStart,
          finishedAt: Date.now(),
        })
        logLength++
        yield stepFinishedEvent({
          stepId,
          stepName: descriptor.name,
          content: stepResult,
        })
        nextValue = stepResult
        continue
      }

      // ---- now / uuid / patched (durable deterministic values) ----
      //
      // These don't emit STEP_STARTED/STEP_FINISHED — they're cheap
      // primitives whose only purpose is to capture a side-effecting
      // value once and replay it. Cluttering the timeline UI with a
      // "running 'now'" entry would be noise.
      if (descriptor.kind === 'now') {
        const value = Date.now()
        await appendStep(runStore, runId, logLength, {
          index: logLength,
          kind: 'now',
          name: 'now',
          result: value,
          startedAt: value,
          finishedAt: value,
        })
        logLength++
        nextValue = value
        continue
      }

      // ---- patched (Temporal-style migration flag) ----
      //
      // The value is deterministic from the run's persisted
      // startingPatches, but the engine still appends a log entry to
      // keep positional replay aligned. Without the entry the replay
      // short-circuit (which is positional) would see N records for
      // N+M yields and silently feed the next-positional record's
      // result back into a `patched` yield — corrupting the boolean.
      // The entry is tiny and never user-visible.
      if (descriptor.kind === 'patched') {
        const patchSet = live.runState.startingPatches ?? []
        const value = patchSet.includes(descriptor.name)
        const ts = Date.now()
        await appendStep(runStore, runId, logLength, {
          index: logLength,
          kind: 'patched',
          name: descriptor.name,
          result: value,
          startedAt: ts,
          finishedAt: ts,
        })
        logLength++
        nextValue = value
        continue
      }

      if (descriptor.kind === 'uuid') {
        // `globalThis.crypto.randomUUID()` is the cross-runtime form
        // (Node 19+, modern browsers, Deno, Bun). Fingerprint check
        // already guards against missing-API drift across deploys.
        const value = globalThis.crypto.randomUUID()
        const ts = Date.now()
        await appendStep(runStore, runId, logLength, {
          index: logLength,
          kind: 'uuid',
          name: 'uuid',
          result: value,
          startedAt: ts,
          finishedAt: ts,
        })
        logLength++
        nextValue = value
        continue
      }

      // ---- nested-workflow ----
      if (descriptor.kind === 'nested-workflow') {
        const startedAt = Date.now()
        yield stepStartedEvent({
          stepId,
          stepName: descriptor.name,
          stepType: 'nested-workflow',
        })

        let nestedOutput: unknown = undefined
        const nestedIter = runWorkflow({
          workflow: descriptor.workflow,
          input: descriptor.input,
          runStore,
          signal: abortController.signal,
          // Propagate the parent's publisher so attached subscribers
          // on other nodes see the nested run's events fanned out
          // under the *nested* run's id. The parent's own publisher
          // wrapper will also re-publish these chunks under the
          // parent runId as they bubble up — fine, subscribers
          // filter by runId.
          publish: args.publish,
          outputSink: (o) => {
            nestedOutput = o
          },
        })

        for await (const chunk of nestedIter) {
          if (chunk.type === 'RUN_STARTED' || chunk.type === 'RUN_FINISHED') {
            continue
          }
          yield chunk
        }

        await appendStep(runStore, runId, logLength, {
          index: logLength,
          kind: 'nested-workflow',
          name: descriptor.name,
          result: nestedOutput,
          startedAt,
          finishedAt: Date.now(),
        })
        logLength++
        yield stepFinishedEvent({
          stepId,
          stepName: descriptor.name,
          content: nestedOutput,
        })
        nextValue = nestedOutput
        continue
      }

      // ---- signal (generic durable pause) ----
      if (descriptor.kind === 'signal') {
        yield stepStartedEvent({
          stepId,
          stepName: descriptor.name,
          stepType: 'signal',
        })

        // Custom event for the push-discovery channel: the originating
        // stream consumer learns of the pause and can register a
        // wakeup callback in its scheduler without waiting on a store
        // poll.
        live.pendingEvents.push({
          type: 'CUSTOM',
          timestamp: Date.now(),
          name: 'run.paused',
          value: {
            runId,
            signalName: descriptor.name,
            deadline: descriptor.deadline,
            kind: descriptor.name === '__timer' ? 'sleep' : 'signal',
            meta: descriptor.meta,
          },
        })
        while (live.pendingEvents.length > 0) yield live.pendingEvents.shift()!

        live.runState = {
          ...live.runState,
          status: 'paused',
          state,
          waitingFor: {
            signalName: descriptor.name,
            deadline: descriptor.deadline,
            meta: descriptor.meta,
          },
          updatedAt: Date.now(),
        }
        // Reuse pendingApprovalStepId as the generic "I'm paused at
        // step X" marker so the in-memory resume path can close out
        // the dangling STEP_STARTED. (Field name is a holdover from
        // v1 — generalizing belongs to a separate refactor.)
        live.pendingApprovalStepId = stepId
        await runStore.setRunState(runId, live.runState)
        return
      }

      // ---- approval (pause) ----
      {
        const approvalDescriptor = descriptor
        const approvalId = generateId('approval')

        yield stepStartedEvent({
          stepId,
          stepName: 'approval',
          stepType: 'approval',
        })

        yield approvalRequestedEvent({
          approvalId,
          title: approvalDescriptor.title,
          description: approvalDescriptor.description,
        })

        live.runState = {
          ...live.runState,
          status: 'paused',
          state,
          pendingApproval: {
            approvalId,
            title: approvalDescriptor.title,
            description: approvalDescriptor.description,
          },
          updatedAt: Date.now(),
        }
        live.pendingApprovalStepId = stepId
        await runStore.setRunState(runId, live.runState)

        // Stream ends; runWorkflow continues after the host posts
        // approval. The approval result is appended to the log on
        // the resume side (when the seed is consumed).
        return
      }
    }

    outputSink?.(finalOutput)

    live.runState = {
      ...live.runState,
      status: 'finished',
      state,
      output: finalOutput,
      updatedAt: Date.now(),
    }
    await runStore.setRunState(runId, live.runState)
    yield runFinishedEvent({ runId, threadId, output: finalOutput })
    await runStore.deleteRun(runId, 'finished')
  } catch (err) {
    if (abortController.signal.aborted) {
      yield runErrorEvent({
        runId,
        message: 'Workflow aborted',
        code: 'aborted',
      })
      await runStore.deleteRun(runId, 'aborted')
      return
    }
    yield runErrorEvent({
      runId,
      message: errorMessage(err),
      code: 'error',
    })
    await runStore.deleteRun(runId, 'error')
  }
}

/**
 * Outcome of a `tryAppendStep` attempt under optimistic CAS.
 *
 * - `appended`  — the write went through; caller continues normally.
 * - `idempotent` — another writer already committed a record with the
 *   *same* signalId at this index. The append is treated as a no-op:
 *   the existing record is authoritative and the caller should use
 *   its `result`/`error` (typical retry scenario — same client
 *   posting twice, host webhook redelivery).
 * - `lost` — another writer committed a record with a *different*
 *   signalId. The caller's signal lost the race; the engine surfaces
 *   `RUN_ERROR { code: 'signal_lost' }` so the loser knows their
 *   delivery did not take effect.
 */
type AppendOutcome =
  | { kind: 'appended' }
  | { kind: 'idempotent'; existing: StepRecord }
  | { kind: 'lost'; existing: StepRecord }

/**
 * Append a step record under optimistic CAS, classifying conflicts.
 *
 * Non-`LogConflictError` errors from the store rethrow — those are
 * infrastructure failures, not concurrency races, and the caller's
 * try/catch in driveLoop maps them to `RUN_ERROR` via the standard
 * path.
 */
async function tryAppendStep(
  runStore: RunStore,
  runId: string,
  expectedNextIndex: number,
  record: StepRecord,
): Promise<AppendOutcome> {
  try {
    await runStore.appendStep(runId, expectedNextIndex, record)
    return { kind: 'appended' }
  } catch (err) {
    if (err instanceof LogConflictError && err.existing) {
      const existing = err.existing
      // Idempotent classification:
      //
      //   (a) Same explicit signalId on both records — host retried a
      //       generic signal delivery; treat as a no-op.
      //   (b) Both records lack a signalId AND share the same kind +
      //       name — typically a legacy `approve()` retry (the legacy
      //       primitive doesn't carry a signalId). Without this case
      //       every approval retry collapses to 'lost', defeating
      //       idempotency for the most common pause kind. The kind+
      //       name check prevents misclassifying a CAS conflict on
      //       other kinds as idempotent.
      const explicitSignalMatch =
        record.signalId !== undefined && existing.signalId === record.signalId
      const implicitApprovalRetry =
        record.signalId === undefined &&
        existing.signalId === undefined &&
        record.kind === existing.kind &&
        record.kind === 'approval' &&
        record.name === existing.name
      if (explicitSignalMatch || implicitApprovalRetry) {
        return { kind: 'idempotent', existing }
      }
      return { kind: 'lost', existing }
    }
    throw err
  }
}

/**
 * Append-or-fail for non-signal step records (nested-workflow, step,
 * now, uuid, patched). These records have no signalId, so the CAS
 * conflict path can never reach 'idempotent' — any conflict is a
 * genuine multi-writer race, which under the v1 contract is a
 * programmer error (the engine is the only writer for its run). We
 * throw to let the driveLoop's outer try/catch surface RUN_ERROR.
 */
async function appendStep(
  runStore: RunStore,
  runId: string,
  expectedNextIndex: number,
  record: StepRecord,
): Promise<void> {
  const outcome = await tryAppendStep(
    runStore,
    runId,
    expectedNextIndex,
    record,
  )
  if (outcome.kind !== 'appended') {
    throw new Error(
      `Log CAS conflict at index ${expectedNextIndex} on ${record.kind}/${record.name} — another writer committed first. Multi-instance writes on a single run are not supported in v1.`,
    )
  }
}
