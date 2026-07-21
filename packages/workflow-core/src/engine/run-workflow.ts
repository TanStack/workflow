import { LogConflictError, StepTimeoutError, WorkflowPaused } from '../types'
import { createWorkflowTelemetry } from '../telemetry'
import { diffState, snapshotState } from './state-diff'
import type {
  AnyMiddleware,
  AnyWorkflowDefinition,
  ApprovalResult,
  ApproveOptions,
  BaseCtx,
  Ctx,
  DeterministicValueOptions,
  RunState,
  RunStore,
  SerializedError,
  ShouldYieldOptions,
  SignalDelivery,
  SleepOptions,
  StepContext,
  StepOptions,
  StepRetryOptions,
  WaitForEventOptions,
  WorkflowEvent,
  YieldOptions,
} from '../types'
import type { WorkflowTelemetry, WorkflowTelemetryOptions } from '../telemetry'

// ============================================================
// Public API
// ============================================================

const DEFAULT_MIN_YIELD_REMAINING_MS = 1_000
const AUTOMATIC_YIELD_STEP_ID_PREFIX = '__runtime-yield-'

export interface RunWorkflowOptions {
  workflow: AnyWorkflowDefinition
  runStore: RunStore
  /** Start: provide `input`. Resume: provide `runId` plus a delivery
   *  (`signalDelivery` or `approval`). Attach: `runId` + `attach: true`. */
  input?: unknown
  runId?: string
  signalDelivery?: SignalDelivery
  approval?: ApprovalResult
  /** Read-only subscription to an existing run. */
  attach?: boolean
  /** External cancellation. */
  signal?: AbortSignal
  /** Thread ID for client-side correlation. */
  threadId?: string
  /** Hook called for every event the engine appends. Hosts wire this
   *  to a fan-out transport (Redis, Durable Streams, EventBridge) so
   *  subscribers on other nodes can tail the run. */
  publish?: (runId: string, event: WorkflowEvent) => void | Promise<void>
  /** Called with the workflow's final output before the run record is
   *  cleaned up. */
  outputSink?: (output: unknown) => void
  /** OpenTelemetry tracing configuration. Uses the global tracer provider
   *  by default and records no payloads/results as attributes. */
  telemetry?: false | WorkflowTelemetryOptions
  /** Absolute UTC ms deadline for this runtime drive. Workflow automatically
   *  yields before fresh durable work when the remaining budget is too low. */
  deadline?: number
  /** Minimum budget that must remain before starting fresh durable work.
   *  Defaults to 1000ms when `deadline` is set. */
  minYieldRemainingMs?: number
  /** UTC ms wake time used for cooperative yields. Runtime sets this past the
   *  current sweep timestamp so yielded runs continue on a later sweep. */
  yieldResumeAt?: number
}

/**
 * Drive a workflow to completion or pause. Returns an `AsyncIterable`
 * of every event the engine appends to the run's log, in order.
 *
 * The same events are simultaneously persisted via
 * `runStore.appendEvent` — the iterable and the persisted log share
 * one shape (the log IS the transport).
 */
export async function* runWorkflow(
  options: RunWorkflowOptions,
): AsyncIterable<WorkflowEvent> {
  // Single event queue: primitives push, this generator yields. A
  // promise-resolve handshake parks the generator between primitives.
  const queue: Array<WorkflowEvent> = []
  let resolveWait: (() => void) | null = null
  let executionDone = false

  const emit = (event: WorkflowEvent) => {
    queue.push(event)
    if (resolveWait) {
      resolveWait()
      resolveWait = null
    }
  }

  // Start execution in the background. Errors are routed through
  // emit() as RUN_ERRORED, so this promise rarely rejects on its own.
  const exec = drive({ ...options, emit })
    .catch(() => {
      // Defensive — every error path in `drive` should emit RUN_ERRORED.
    })
    .finally(() => {
      executionDone = true
      if (resolveWait) {
        resolveWait()
        resolveWait = null
      }
    })

  let runIdForPublish = options.runId

  // Yielding loop. `executionDone` flips inside the async `.finally`
  // above and is read here — eslint can't track that flow, so the
  // condition is suppressed locally.
  for (;;) {
    while (queue.length > 0) {
      const event = queue.shift()!
      // Capture runId as it emerges from RUN_STARTED, so the publish
      // callback always carries the right key (start-paths don't know
      // the runId at construction time).
      if (!runIdForPublish && event.type === 'RUN_STARTED') {
        runIdForPublish = event.runId
      }
      if (options.publish && runIdForPublish) {
        // Best-effort fan-out. A misbehaving publisher must not break
        // the run — swallow and continue.
        try {
          await options.publish(runIdForPublish, event)
        } catch {
          /* swallow */
        }
      }
      yield event
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated in async `.finally` above
    if (executionDone) break
    await new Promise<void>((r) => {
      resolveWait = r
    })
  }

  await exec
}

// ============================================================
// Internal driver — entry-point dispatch (start vs resume vs attach)
// ============================================================

interface DriveOptions extends RunWorkflowOptions {
  emit: (event: WorkflowEvent) => void
  telemetryImpl?: WorkflowTelemetry
}

type DeliveryLostCode = 'signal_lost' | 'approval_lost'

async function drive(options: DriveOptions): Promise<void> {
  options.telemetryImpl ??= createWorkflowTelemetry(
    options.telemetry,
    '@tanstack/workflow-core',
  )

  if (options.runId && options.attach) {
    await attachRun(options)
    return
  }
  if (options.runId && (options.signalDelivery || options.approval)) {
    await resumeRun(options)
    return
  }
  if (options.input === undefined) {
    throw new Error(
      'runWorkflow: provide `input` (start), `runId` + `signalDelivery`/`approval` (resume), or `runId` + `attach: true` (attach).',
    )
  }
  await startRun(options)
}

// ============================================================
// Start
// ============================================================

async function startRun(options: DriveOptions): Promise<void> {
  const { workflow, runStore, emit } = options
  const runId = options.runId ?? generateId('run')

  // Idempotency check: if the caller supplied a runId and a run
  // already exists at that id, redirect to attach so they get a
  // consistent envelope of events instead of a second start.
  if (options.runId) {
    const existing = await runStore.getRunState(runId)
    if (existing) {
      await attachRun({ ...options, attach: true })
      return
    }
  }

  const abortController = setupAbort(options.signal)

  // Validate + build initial state. State itself is NOT persisted;
  // it's reconstructed on every invocation by replay.
  let input: unknown
  let state: Record<string, unknown>
  try {
    input = validateWorkflowInput(workflow, options.input)
    state = buildInitialState(workflow, input)
  } catch (err) {
    emit({
      type: 'RUN_ERRORED',
      ts: Date.now(),
      runId,
      error: serializeError(err),
      code: 'validation_error',
    })
    return
  }

  const runState: RunState = {
    runId,
    status: 'running',
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    input,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await runStore.setRunState(runId, runState)

  // RUN_STARTED is observability-only — every invocation emits one as a
  // stream-opener. Don't persist (it would consume log index 0 and
  // collide with the first checkpoint append).
  emit({
    type: 'RUN_STARTED',
    ts: Date.now(),
    runId,
    threadId: options.threadId,
  })

  await driveHandler({
    options,
    runId,
    runState,
    input,
    state,
    history: [],
    abortController,
  })
}

// ============================================================
// Resume
// ============================================================

async function resumeRun(options: DriveOptions): Promise<void> {
  const { workflow, runStore, emit } = options
  const runId = options.runId!

  const persistedState = await runStore.getRunState(runId)
  if (!persistedState) {
    emit({
      type: 'RUN_ERRORED',
      ts: Date.now(),
      runId,
      error: { name: 'RunLost', message: `Run ${runId} not found.` },
      code: 'run_lost',
    })
    return
  }
  if (
    persistedState.status === 'finished' ||
    persistedState.status === 'errored' ||
    persistedState.status === 'aborted'
  ) {
    await attachRun({ ...options, attach: true })
    return
  }

  // Route to the right code version for this run.
  const effectiveWorkflow = selectVersionForRun(workflow, persistedState)
  if (!effectiveWorkflow) {
    emit({
      type: 'RUN_ERRORED',
      ts: Date.now(),
      runId,
      error: {
        name: 'WorkflowVersionMismatch',
        message: `No registered workflow version matches the run's persisted version "${persistedState.workflowVersion ?? '(none)'}". Register the version via \`previousVersions\` on the current workflow.`,
      },
      code: 'workflow_version_mismatch',
    })
    return
  }

  const history = await runStore.getEvents(runId)

  // Append the seed delivery before driving the handler. Replay's
  // history lookup will then find the SIGNAL_RESOLVED / APPROVAL_RESOLVED
  // at the appropriate primitive call.
  const seedAppendOutcome = await appendSeed({
    runStore,
    runId,
    history,
    persistedState,
    signalDelivery: options.signalDelivery,
    approval: options.approval,
    emit,
  })
  if (seedAppendOutcome.kind === 'lost') {
    emit({
      type: 'RUN_ERRORED',
      ts: Date.now(),
      runId,
      error: {
        name:
          seedAppendOutcome.code === 'approval_lost'
            ? 'ApprovalLost'
            : 'SignalLost',
        message: seedAppendOutcome.message,
      },
      code: seedAppendOutcome.code,
    })
    return
  }

  const updatedHistory = await runStore.getEvents(runId)

  const abortController = setupAbort(options.signal)
  const state = buildInitialState(effectiveWorkflow, persistedState.input)

  const runState: RunState = {
    ...persistedState,
    status: 'running',
    workflowVersion: effectiveWorkflow.version,
    awaiting: undefined,
    waitingFor: undefined,
    pendingApproval: undefined,
    updatedAt: Date.now(),
  }
  await runStore.setRunState(runId, runState)

  // RUN_STARTED is observability-only; emit on every resume for a
  // consistent stream opener.
  emit({
    type: 'RUN_STARTED',
    ts: Date.now(),
    runId,
    threadId: options.threadId,
  })

  await driveHandler({
    options: { ...options, workflow: effectiveWorkflow },
    runId,
    runState,
    input: persistedState.input,
    state,
    history: updatedHistory,
    abortController,
  })
}

// ============================================================
// Attach (read-only snapshot)
// ============================================================

async function attachRun(options: DriveOptions): Promise<void> {
  const { runStore, emit } = options
  const runId = options.runId!

  const persistedState = await runStore.getRunState(runId)
  if (!persistedState) {
    emit({
      type: 'RUN_ERRORED',
      ts: Date.now(),
      runId,
      error: { name: 'RunLost', message: `Run ${runId} not found.` },
      code: 'run_lost',
    })
    return
  }

  emit({
    type: 'RUN_STARTED',
    ts: Date.now(),
    runId,
    threadId: options.threadId,
  })

  // Replay the entire log so the attaching subscriber gets full
  // history without polling.
  const events = await runStore.getEvents(runId)
  for (const event of events) emit(event)
  const hasPersistedTerminal = events.some(
    (event) => event.type === 'RUN_FINISHED' || event.type === 'RUN_ERRORED',
  )

  if (persistedState.status === 'finished' && !hasPersistedTerminal) {
    emit({
      type: 'RUN_FINISHED',
      ts: Date.now(),
      runId,
      output: persistedState.output,
    })
    return
  }
  if (
    !hasPersistedTerminal &&
    (persistedState.status === 'errored' || persistedState.status === 'aborted')
  ) {
    emit({
      type: 'RUN_ERRORED',
      ts: Date.now(),
      runId,
      error: persistedState.error ?? {
        name: 'Unknown',
        message: 'Run ended in non-terminal state',
      },
      code: persistedState.status === 'aborted' ? 'aborted' : 'error',
    })
    return
  }
  // status === 'paused' or 'running' — caller has the snapshot; live
  // tailing requires the publisher hook.
}

// ============================================================
// Handler drive (the closure replay loop)
// ============================================================

interface DriveHandlerArgs {
  options: DriveOptions
  runId: string
  runState: RunState
  input: unknown
  state: Record<string, unknown>
  history: ReadonlyArray<WorkflowEvent>
  abortController: AbortController
}

async function driveHandler(args: DriveHandlerArgs): Promise<void> {
  const { options, runId, state, history, abortController } = args
  const { workflow, runStore, emit } = options

  // Per-run mutable engine state passed to every primitive call.
  const engine: EngineRuntime = {
    runId,
    workflow,
    runStore,
    emit,
    abortController,
    telemetry: options.telemetryImpl!,
    history: [...history],
    nextLogIndex: history.length,
    consumed: new Set(),
    counters: {
      wait: 0,
      sleep: 0,
      approve: 0,
      now: 0,
      uuid: 0,
      yield: 0,
    },
    deadline: options.deadline,
    minYieldRemainingMs:
      options.minYieldRemainingMs ?? DEFAULT_MIN_YIELD_REMAINING_MS,
    yieldResumeAt: options.yieldResumeAt,
    prevStateSnapshot: snapshotState(state),
    state,
    paused: false,
  }

  const baseCtx: BaseCtx<unknown, Record<string, unknown>> = {
    runId,
    input: args.input,
    state,
    signal: abortController.signal,
    runtime: {
      deadline: options.deadline,
      timeRemaining: () => timeRemaining(engine),
      shouldYield: (opts) => shouldYield(engine, opts),
      yield: (opts) => engineYield(engine, opts),
    },

    step: (id, fn, opts) => engineStep(engine, id, fn, opts),
    sleep: (ms, opts) => engineSleep(engine, ms, opts),
    sleepUntil: (ts, opts) => engineSleepUntil(engine, ts, opts),
    waitForEvent: (name, opts) => engineWaitForEvent(engine, name, opts),
    approve: (opts) => engineApprove(engine, opts),
    now: (opts) => engineNow(engine, opts),
    uuid: (opts) => engineUuid(engine, opts),

    emit: (name, value) => {
      const event: WorkflowEvent = {
        type: 'CUSTOM',
        ts: Date.now(),
        name,
        value,
      }
      emit(event)
    },
  }

  // Compose middlewares around the handler. Each middleware can
  // mutate `ctx` in place via `next({ ...extension })`; the mutation
  // is visible to downstream middleware and the handler.
  const ctx = baseCtx as Ctx<unknown, Record<string, unknown>, any>

  let output: unknown
  try {
    output = await composeMiddlewares(
      workflow.middlewares,
      ctx,
      workflow.handler,
    )
    // A handler can accidentally catch the internal pause sentinel. The pause
    // was already persisted, so it must still win over a normal handler return.
    if (engine.paused) return
    output = validateWorkflowOutput(workflow, output)
    // Flush any final state delta.
    flushStateDelta(engine)
  } catch (err) {
    flushStateDelta(engine)

    if (engine.paused) {
      // The primitive that paused (engineWaitForEvent / engineApprove)
      // already wrote the pause state — status, waitingFor /
      // pendingApproval — directly to the store. Don't overwrite with
      // our local snapshot, which doesn't carry those fields.
      return
    }

    if (abortController.signal.aborted) {
      args.runState.status = 'aborted'
      args.runState.updatedAt = Date.now()
      await runStore.setRunState(runId, args.runState)
      const errEvent: WorkflowEvent = {
        type: 'RUN_ERRORED',
        ts: Date.now(),
        runId,
        error: { name: 'Aborted', message: 'Workflow aborted' },
        code: 'aborted',
      }
      await emitAndAppend(
        runStore,
        runId,
        engine.nextLogIndex++,
        emit,
        errEvent,
      )
      return
    }

    args.runState.status = 'errored'
    args.runState.error = serializeError(err)
    args.runState.updatedAt = Date.now()
    await runStore.setRunState(runId, args.runState)
    const errEvent: WorkflowEvent = {
      type: 'RUN_ERRORED',
      ts: Date.now(),
      runId,
      error: serializeError(err),
      code: 'error',
    }
    await emitAndAppend(runStore, runId, engine.nextLogIndex++, emit, errEvent)
    return
  }

  // Success.
  options.outputSink?.(output)
  args.runState.status = 'finished'
  args.runState.output = output
  args.runState.updatedAt = Date.now()
  await runStore.setRunState(runId, args.runState)
  const finishedEvent: WorkflowEvent = {
    type: 'RUN_FINISHED',
    ts: Date.now(),
    runId,
    output,
  }
  await emitAndAppend(
    runStore,
    runId,
    engine.nextLogIndex++,
    emit,
    finishedEvent,
  )
}

// ============================================================
// Engine runtime — shared mutable state across primitives
// ============================================================

interface EngineRuntime {
  runId: string
  workflow: AnyWorkflowDefinition
  runStore: RunStore
  emit: (event: WorkflowEvent) => void
  abortController: AbortController
  telemetry: WorkflowTelemetry
  /** Pre-loaded log from prior invocations, used for replay short-
   *  circuit. */
  history: ReadonlyArray<WorkflowEvent>
  /** Next index at which a fresh append must land. Starts at
   *  `history.length`; advances on every append. */
  nextLogIndex: number
  /** Indices in `history` already consumed by a primitive call this
   *  invocation. Sequential-match primitives (waitForEvent, approve,
   *  now, uuid, sleep) pick the first unconsumed checkpoint of their
   *  kind. */
  consumed: Set<number>
  /** Per-kind counters for primitives without user-supplied IDs.
   *  Used to generate stable per-call stepIds. */
  counters: {
    wait: number
    sleep: number
    approve: number
    now: number
    uuid: number
    yield: number
  }
  deadline?: number
  minYieldRemainingMs: number
  yieldResumeAt?: number
  prevStateSnapshot: Record<string, unknown>
  state: Record<string, unknown>
  /** Set to `true` by the primitive that paused the run, so the
   *  outer catch knows not to write a terminal event. */
  paused: boolean
}

function timeRemaining(engine: EngineRuntime): number {
  if (engine.deadline === undefined) return Number.POSITIVE_INFINITY
  return Math.max(0, engine.deadline - Date.now())
}

function shouldYield(
  engine: EngineRuntime,
  options?: ShouldYieldOptions,
): boolean {
  if (engine.deadline === undefined) return false
  const minRemainingMs = Math.max(
    0,
    options?.minRemainingMs ?? engine.minYieldRemainingMs,
  )
  return timeRemaining(engine) <= minRemainingMs
}

async function yieldForDeadlineIfNeeded(engine: EngineRuntime): Promise<void> {
  if (!shouldYield(engine)) return

  const previousYields = engine.history.filter(
    (event) =>
      event.type === 'SIGNAL_AWAITED' &&
      event.name === '__timer' &&
      event.stepId.startsWith(AUTOMATIC_YIELD_STEP_ID_PREFIX),
  ).length

  await engineWaitForEvent<void>(engine, '__timer', {
    id: `${AUTOMATIC_YIELD_STEP_ID_PREFIX}${previousYields}`,
    deadline: engine.yieldResumeAt ?? Date.now() + 1,
    meta: { reason: 'deadline' },
  })
}

// ============================================================
// Primitives — replay-aware durable steps
// ============================================================

async function engineStep<T>(
  engine: EngineRuntime,
  stepId: string,
  fn: (ctx: StepContext) => T | Promise<T>,
  options?: StepOptions,
): Promise<T> {
  flushStateDelta(engine)

  // Replay short-circuit: a STEP_FINISHED or STEP_FAILED already
  // exists for this stepId. Return the cached result or rethrow.
  const cached = findCheckpoint(
    engine,
    (e, i) =>
      !engine.consumed.has(i) &&
      (e.type === 'STEP_FINISHED' || e.type === 'STEP_FAILED') &&
      e.stepId === stepId,
  )
  if (cached) {
    engine.telemetry.addActiveSpanEvent('workflow.step.replayed', {
      'tanstack.workflow.workflow_id': engine.workflow.id,
      'tanstack.workflow.workflow_version': engine.workflow.version,
      'tanstack.workflow.run_id': engine.runId,
      'tanstack.workflow.step_id': stepId,
    })
    if (cached.event.type === 'STEP_FAILED') {
      throw rehydrateError(cached.event.error)
    }
    // Discriminated narrowing: the predicate filtered to FINISHED|FAILED;
    // the branch above handled FAILED, so this is FINISHED.
    const event = cached.event as Extract<
      WorkflowEvent,
      { type: 'STEP_FINISHED' }
    >
    return event.result as T
  }

  await yieldForDeadlineIfNeeded(engine)

  // Fresh execution.
  engine.emit({
    type: 'STEP_STARTED',
    ts: Date.now(),
    stepId,
    meta: options?.meta,
  })

  return await engine.telemetry.startActiveSpan(
    'step',
    {
      workflowId: engine.workflow.id,
      workflowVersion: engine.workflow.version,
      runId: engine.runId,
      stepId,
    },
    async (span) => {
      const retryPolicy = options?.retry ?? engine.workflow.defaultStepRetry
      const maxAttempts = Math.max(1, retryPolicy?.maxAttempts ?? 1)
      const attempts: Array<{
        startedAt: number
        finishedAt: number
        result?: unknown
        error?: SerializedError
      }> = []
      let lastError: unknown
      let result: unknown
      let succeeded = false

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const attemptStart = Date.now()
        span.addEvent('workflow.step.attempt.started', { attempt })
        const attemptController = new AbortController()
        // Eager propagation: addEventListener doesn't fire for already-
        // aborted signals, so check + abort upfront.
        if (engine.abortController.signal.aborted) attemptController.abort()
        const onParentAbort = () => attemptController.abort()
        engine.abortController.signal.addEventListener('abort', onParentAbort, {
          once: true,
        })
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null
        let timedOut = false
        if (options?.timeout && options.timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true
            span.addEvent('workflow.step.attempt.timeout', { attempt })
            attemptController.abort()
          }, options.timeout)
        }

        try {
          const fnPromise = Promise.resolve(
            fn({
              id: `${engine.runId}:${stepId}`,
              attempt,
              runtime: {
                deadline: engine.deadline,
                timeRemaining: () => timeRemaining(engine),
                shouldYield: (opts) => shouldYield(engine, opts),
              },
              signal: attemptController.signal,
            }),
          )
          result = options?.timeout
            ? await Promise.race([
                fnPromise,
                new Promise<never>((_, reject) => {
                  attemptController.signal.addEventListener(
                    'abort',
                    () => {
                      if (timedOut) {
                        reject(new StepTimeoutError(stepId, options.timeout!))
                      } else if (engine.abortController.signal.aborted) {
                        reject(new Error('Workflow aborted'))
                      } else {
                        reject(new StepTimeoutError(stepId, options.timeout!))
                      }
                    },
                    { once: true },
                  )
                }),
              ])
            : await fnPromise
          attempts.push({
            startedAt: attemptStart,
            finishedAt: Date.now(),
            result,
          })
          span.addEvent('workflow.step.attempt.finished', { attempt })
          succeeded = true
          if (timeoutHandle) clearTimeout(timeoutHandle)
          engine.abortController.signal.removeEventListener(
            'abort',
            onParentAbort,
          )
          break
        } catch (err) {
          if (timeoutHandle) clearTimeout(timeoutHandle)
          engine.abortController.signal.removeEventListener(
            'abort',
            onParentAbort,
          )
          lastError = err
          attempts.push({
            startedAt: attemptStart,
            finishedAt: Date.now(),
            error: serializeError(err),
          })
          span.addEvent('workflow.step.attempt.failed', { attempt })
          const shouldRetry =
            attempt < maxAttempts &&
            (retryPolicy?.shouldRetry?.(err, attempt) ?? true)
          if (!shouldRetry) break
          const delayMs = computeBackoffMs(retryPolicy, attempt)
          if (delayMs > 0) {
            await new Promise<void>((resolve) => {
              const t = setTimeout(resolve, delayMs)
              engine.abortController.signal.addEventListener(
                'abort',
                () => {
                  clearTimeout(t)
                  resolve()
                },
                { once: true },
              )
            })
            if (engine.abortController.signal.aborted) break
          }
        }
      }

      if (!succeeded) {
        const failedEvent: WorkflowEvent = {
          type: 'STEP_FAILED',
          ts: Date.now(),
          stepId,
          error: serializeError(lastError),
          attempts: attempts.length > 1 ? attempts : undefined,
          meta: options?.meta,
        }
        await emitAndAppend(
          engine.runStore,
          engine.runId,
          engine.nextLogIndex++,
          engine.emit,
          failedEvent,
        )
        throw rehydrateError(serializeError(lastError))
      }

      const finishedEvent: WorkflowEvent = {
        type: 'STEP_FINISHED',
        ts: Date.now(),
        stepId,
        result,
        attempts: attempts.length > 1 ? attempts : undefined,
        meta: options?.meta,
      }
      await emitAndAppend(
        engine.runStore,
        engine.runId,
        engine.nextLogIndex++,
        engine.emit,
        finishedEvent,
      )
      return result as T
    },
    engine.telemetry.mapStepMeta(options?.meta, {
      workflowId: engine.workflow.id,
      workflowVersion: engine.workflow.version,
      runId: engine.runId,
      stepId,
    }),
  )
}

async function engineWaitForEvent<TPayload>(
  engine: EngineRuntime,
  name: string,
  options?: WaitForEventOptions<TPayload>,
): Promise<TPayload> {
  flushStateDelta(engine)
  const stepId = options?.id ?? `__wait-${name}-${engine.counters.wait++}`

  // Match by durable operation id. With no explicit id we still use
  // the generated positional id for backwards-compatible ergonomics.
  const cached = findCheckpoint(
    engine,
    (e, i) =>
      !engine.consumed.has(i) &&
      e.type === 'SIGNAL_RESOLVED' &&
      e.name === name &&
      e.stepId === stepId,
  )
  if (cached) {
    const payload = (
      cached.event as Extract<WorkflowEvent, { type: 'SIGNAL_RESOLVED' }>
    ).payload as TPayload
    if (options?.schema) {
      const validated = options.schema['~standard'].validate(payload)
      if (validated instanceof Promise) {
        throw new Error(
          `waitForEvent("${name}"): schema validates asynchronously, which is not supported.`,
        )
      }
      if (validated.issues) {
        throw new Error(
          `waitForEvent("${name}"): payload failed schema validation.`,
        )
      }
      return validated.value
    }
    return payload
  }

  // Not yet resolved — pause the run.
  await emitAndAppend(
    engine.runStore,
    engine.runId,
    engine.nextLogIndex++,
    engine.emit,
    {
      type: 'SIGNAL_AWAITED',
      ts: Date.now(),
      stepId,
      name,
      deadline: options?.deadline,
      meta: options?.meta,
    },
  )

  // Persist waitingFor on the run state so out-of-process workers can
  // discover the pending wake.
  const persisted = await engine.runStore.getRunState(engine.runId)
  if (persisted) {
    await engine.runStore.setRunState(engine.runId, {
      ...persisted,
      status: 'paused',
      awaiting: [
        {
          type: 'signal',
          stepId,
          signalName: name,
          deadline: options?.deadline,
          meta: options?.meta,
        },
      ],
      waitingFor: {
        stepId,
        signalName: name,
        deadline: options?.deadline,
        meta: options?.meta,
      },
      pendingApproval: undefined,
      updatedAt: Date.now(),
    })
  }

  engine.paused = true
  throw new WorkflowPaused()
}

function engineSleepUntil(
  engine: EngineRuntime,
  timestamp: number,
  options?: SleepOptions,
): Promise<void> {
  return engineWaitForEvent<void>(engine, '__timer', {
    ...options,
    id: options?.id ?? `__sleep-${engine.counters.sleep++}`,
    deadline: timestamp,
  })
}

function engineSleep(
  engine: EngineRuntime,
  ms: number,
  options?: SleepOptions,
): Promise<void> {
  return engineSleepUntil(engine, Date.now() + ms, options)
}

function engineYield(
  engine: EngineRuntime,
  options: YieldOptions = {},
): Promise<void> {
  const meta =
    options.reason === undefined
      ? options.meta
      : { ...options.meta, reason: options.reason }

  return engineWaitForEvent<void>(engine, '__timer', {
    id: options.id ?? `__yield-${engine.counters.yield++}`,
    deadline: engine.yieldResumeAt ?? Date.now() + 1,
    meta,
  })
}

async function engineApprove(
  engine: EngineRuntime,
  approveOptions: ApproveOptions,
): Promise<ApprovalResult> {
  flushStateDelta(engine)
  const stepId = approveOptions.id ?? `__approve-${engine.counters.approve++}`

  const cached = findCheckpoint(
    engine,
    (e, i) =>
      !engine.consumed.has(i) &&
      e.type === 'APPROVAL_RESOLVED' &&
      e.stepId === stepId,
  )
  if (cached) {
    const event = cached.event as Extract<
      WorkflowEvent,
      { type: 'APPROVAL_RESOLVED' }
    >
    return {
      approved: event.approved,
      approvalId: event.approvalId,
      feedback: event.feedback,
      meta: event.meta,
    }
  }

  const approvalId = generateId('approval')
  await emitAndAppend(
    engine.runStore,
    engine.runId,
    engine.nextLogIndex++,
    engine.emit,
    {
      type: 'APPROVAL_REQUESTED',
      ts: Date.now(),
      stepId,
      approvalId,
      title: approveOptions.title,
      description: approveOptions.description,
      meta: approveOptions.meta,
    },
  )

  const persisted = await engine.runStore.getRunState(engine.runId)
  if (persisted) {
    await engine.runStore.setRunState(engine.runId, {
      ...persisted,
      status: 'paused',
      awaiting: [
        {
          type: 'approval',
          stepId,
          approvalId,
          title: approveOptions.title,
          description: approveOptions.description,
          meta: approveOptions.meta,
        },
      ],
      waitingFor: undefined,
      pendingApproval: {
        stepId,
        approvalId,
        title: approveOptions.title,
        description: approveOptions.description,
        meta: approveOptions.meta,
      },
      updatedAt: Date.now(),
    })
  }

  engine.paused = true
  throw new WorkflowPaused()
}

async function engineNow(
  engine: EngineRuntime,
  options?: DeterministicValueOptions,
): Promise<number> {
  flushStateDelta(engine)
  const stepId = options?.id ?? `__now-${engine.counters.now++}`
  const cached = findCheckpoint(
    engine,
    (e, i) =>
      !engine.consumed.has(i) &&
      e.type === 'NOW_RECORDED' &&
      e.stepId === stepId,
  )
  if (cached) {
    return (cached.event as Extract<WorkflowEvent, { type: 'NOW_RECORDED' }>)
      .value
  }
  await yieldForDeadlineIfNeeded(engine)
  const value = Date.now()
  await emitAndAppend(
    engine.runStore,
    engine.runId,
    engine.nextLogIndex++,
    engine.emit,
    { type: 'NOW_RECORDED', ts: value, stepId, value, meta: options?.meta },
  )
  return value
}

async function engineUuid(
  engine: EngineRuntime,
  options?: DeterministicValueOptions,
): Promise<string> {
  flushStateDelta(engine)
  const stepId = options?.id ?? `__uuid-${engine.counters.uuid++}`
  const cached = findCheckpoint(
    engine,
    (e, i) =>
      !engine.consumed.has(i) &&
      e.type === 'UUID_RECORDED' &&
      e.stepId === stepId,
  )
  if (cached) {
    return (cached.event as Extract<WorkflowEvent, { type: 'UUID_RECORDED' }>)
      .value
  }
  await yieldForDeadlineIfNeeded(engine)
  const value = globalThis.crypto.randomUUID()
  await emitAndAppend(
    engine.runStore,
    engine.runId,
    engine.nextLogIndex++,
    engine.emit,
    {
      type: 'UUID_RECORDED',
      ts: Date.now(),
      stepId,
      value,
      meta: options?.meta,
    },
  )
  return value
}

// ============================================================
// Middleware composition
// ============================================================

const reservedCtxFields = new Set([
  'runId',
  'input',
  'state',
  'signal',
  'runtime',
  'step',
  'sleep',
  'sleepUntil',
  'waitForEvent',
  'approve',
  'now',
  'uuid',
  'emit',
])

function composeMiddlewares(
  middlewares: ReadonlyArray<AnyMiddleware>,
  ctx: Ctx<any, any, any>,
  handler: (ctx: Ctx<any, any, any>) => Promise<unknown>,
): Promise<unknown> {
  const compose = async (index: number): Promise<unknown> => {
    if (index >= middlewares.length) return handler(ctx)
    const m = middlewares[index]!
    let returned: unknown
    let advanced = false
    await m.server({
      ctx,
      next: async (opts) => {
        if (advanced) {
          throw new Error(
            'middleware.next() must be called at most once per invocation',
          )
        }
        advanced = true
        // Merge the extension into the shared ctx reference.
        // Downstream middleware and the handler observe the same
        // ctx, so writes here are visible there.
        const ext = opts.context
        if (ext && typeof ext === 'object') {
          for (const key of Object.keys(ext)) {
            if (reservedCtxFields.has(key)) {
              throw new Error(
                `Middleware extension may not shadow reserved ctx field: ${key}`,
              )
            }
          }
          Object.assign(ctx, ext)
        }
        returned = await compose(index + 1)
        return returned
      },
    })
    return returned
  }
  return compose(0)
}

// ============================================================
// Helpers
// ============================================================

function setupAbort(external?: AbortSignal): AbortController {
  const ctrl = new AbortController()
  if (external) {
    if (external.aborted) ctrl.abort()
    else external.addEventListener('abort', () => ctrl.abort(), { once: true })
  }
  return ctrl
}

function validateWorkflowInput(
  workflow: AnyWorkflowDefinition,
  input: unknown,
): unknown {
  if (!workflow.inputSchema) return input
  return validateSyncSchema(
    workflow.inputSchema,
    input,
    `Workflow "${workflow.id}" input`,
  )
}

function validateWorkflowOutput(
  workflow: AnyWorkflowDefinition,
  output: unknown,
): unknown {
  if (!workflow.outputSchema) return output
  return validateSyncSchema(
    workflow.outputSchema,
    output,
    `Workflow "${workflow.id}" output`,
  )
}

function buildInitialState(
  workflow: AnyWorkflowDefinition,
  input: unknown,
): Record<string, unknown> {
  const initial: Record<string, unknown> = workflow.initialize
    ? workflow.initialize({ input: input as never })
    : {}
  if (!workflow.stateSchema) return initial
  return validateSyncSchema(
    workflow.stateSchema,
    initial,
    `Workflow "${workflow.id}" initial state`,
  ) as Record<string, unknown>
}

function validateSyncSchema(
  schema: NonNullable<AnyWorkflowDefinition['inputSchema']>,
  value: unknown,
  label: string,
): unknown {
  const validated = schema['~standard'].validate(value)
  if (validated instanceof Promise) {
    throw new Error(
      `${label} schema validates asynchronously, which is not supported.`,
    )
  }
  if (validated.issues) {
    throw new Error(`${label} failed schema validation.`)
  }
  return validated.value
}

function selectVersionForRun(
  current: AnyWorkflowDefinition,
  runState: RunState,
): AnyWorkflowDefinition | undefined {
  // Runs with no recorded version match the current workflow only
  // if the current also has no version (legacy compat).
  if (!runState.workflowVersion) {
    if (!current.version) return current
    // The run was started before versioning; fall back to current
    // for forward compatibility. Hosts that want strict refusal can
    // wrap `runWorkflow` and gate on this themselves.
    return current
  }
  if (current.version === runState.workflowVersion) return current
  for (const prev of current.previousVersions ?? []) {
    if (prev.version === runState.workflowVersion) return prev
  }
  return undefined
}

type CheckpointMatch = { event: WorkflowEvent; index: number }

function findCheckpoint(
  engine: EngineRuntime,
  predicate: (event: WorkflowEvent, index: number) => boolean,
): CheckpointMatch | undefined {
  for (let i = 0; i < engine.history.length; i++) {
    if (engine.consumed.has(i)) continue
    const e = engine.history[i]!
    if (predicate(e, i)) {
      engine.consumed.add(i)
      return { event: e, index: i }
    }
  }
  return undefined
}

async function emitAndAppend(
  runStore: RunStore,
  runId: string,
  index: number,
  emit: (event: WorkflowEvent) => void,
  event: WorkflowEvent,
): Promise<void> {
  // Append-first: the log is the durable truth. Only emit
  // observably after we know it's persisted.
  await runStore.appendEvent(runId, index, event)
  emit(event)
}

function flushStateDelta(engine: EngineRuntime): void {
  const delta = diffState(engine.prevStateSnapshot, engine.state)
  if (delta.length === 0) return
  engine.prevStateSnapshot = snapshotState(engine.state)
  // STATE_DELTA is emit-only — observability for the current
  // invocation's consumer. State is derived from log replay, so we
  // don't persist deltas. (If we did, replay would either re-append
  // them on every invocation, or we'd need a way to skip during
  // replay.)
  engine.emit({ type: 'STATE_DELTA', ts: Date.now(), delta })
}

function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack }
  }
  return { name: 'UnknownError', message: String(err) }
}

function rehydrateError(serialized: SerializedError): Error {
  const err = new Error(serialized.message)
  err.name = serialized.name
  if (serialized.stack) err.stack = serialized.stack
  return err
}

function computeBackoffMs(
  policy: StepRetryOptions | undefined,
  attempt: number,
): number {
  if (!policy) return 0
  const base = policy.baseMs ?? 500
  if (typeof policy.backoff === 'function') return policy.backoff(attempt)
  if (policy.backoff === 'fixed') return base
  return base * 2 ** (attempt - 1)
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

// ============================================================
// Seed delivery for resume
// ============================================================

type SeedAppendOutcome =
  | { kind: 'appended' | 'idempotent' }
  | { kind: 'lost'; code: DeliveryLostCode; message: string }

async function appendSeed(args: {
  runStore: RunStore
  runId: string
  history: ReadonlyArray<WorkflowEvent>
  persistedState: RunState
  signalDelivery?: SignalDelivery
  approval?: ApprovalResult
  emit: (event: WorkflowEvent) => void
}): Promise<SeedAppendOutcome> {
  const {
    runStore,
    runId,
    history,
    persistedState,
    signalDelivery,
    approval,
    emit,
  } = args

  if (signalDelivery) {
    const waitingFor = persistedState.waitingFor
    if (
      waitingFor?.signalName !== signalDelivery.name ||
      (signalDelivery.stepId !== undefined &&
        waitingFor.stepId !== undefined &&
        waitingFor.stepId !== signalDelivery.stepId)
    ) {
      return {
        kind: 'lost',
        code: 'signal_lost',
        message: `Signal delivery lost: run is not waiting for "${signalDelivery.name}".`,
      }
    }
    const targetStepId = signalDelivery.stepId ?? waitingFor.stepId
    // Locate the most recent SIGNAL_AWAITED for this name/id. The
    // resolution attached to that await is what the caller is
    // racing against.
    let awaitedIdx = -1
    let awaitedStepId = targetStepId
    for (let i = history.length - 1; i >= 0; i--) {
      const e = history[i]!
      if (
        e.type === 'SIGNAL_AWAITED' &&
        e.name === signalDelivery.name &&
        (!targetStepId || e.stepId === targetStepId)
      ) {
        awaitedIdx = i
        awaitedStepId = e.stepId
        break
      }
    }
    if (awaitedIdx >= 0) {
      // Walk forward from the await: if a SIGNAL_RESOLVED already
      // landed, classify against its signalId.
      for (let i = awaitedIdx + 1; i < history.length; i++) {
        const e = history[i]!
        if (
          e.type === 'SIGNAL_RESOLVED' &&
          e.name === signalDelivery.name &&
          (!awaitedStepId || e.stepId === awaitedStepId)
        ) {
          if (e.signalId === signalDelivery.signalId) {
            return { kind: 'idempotent' }
          }
          // A different writer's resolution already landed —
          // this caller lost the race.
          return {
            kind: 'lost',
            code: 'signal_lost',
            message: 'Signal delivery lost: another delivery won the race.',
          }
        }
      }
    }
    // Otherwise append a fresh resolution.
    const event: WorkflowEvent = {
      type: 'SIGNAL_RESOLVED',
      ts: Date.now(),
      stepId: awaitedStepId ?? `__resolve-${signalDelivery.name}`,
      name: signalDelivery.name,
      signalId: signalDelivery.signalId,
      payload: signalDelivery.payload,
      meta: signalDelivery.meta,
    }
    try {
      await runStore.appendEvent(runId, history.length, event)
      emit(event)
      return { kind: 'appended' }
    } catch (err) {
      if (err instanceof LogConflictError) {
        // Refetch + reclassify.
        const refreshed = await runStore.getEvents(runId)
        for (let i = history.length; i < refreshed.length; i++) {
          const e = refreshed[i]!
          if (
            e.type === 'SIGNAL_RESOLVED' &&
            e.name === signalDelivery.name &&
            (!awaitedStepId || e.stepId === awaitedStepId) &&
            e.signalId === signalDelivery.signalId
          ) {
            return { kind: 'idempotent' }
          }
        }
        return {
          kind: 'lost',
          code: 'signal_lost',
          message: 'Signal delivery lost: another delivery won the race.',
        }
      }
      throw err
    }
  }

  if (approval) {
    const pendingApproval = persistedState.pendingApproval
    if (pendingApproval?.approvalId !== approval.approvalId) {
      return {
        kind: 'lost',
        code: 'approval_lost',
        message: `Approval delivery lost: run is not waiting for approval "${approval.approvalId}".`,
      }
    }
    const stepId =
      pendingApproval.stepId ?? findApprovalRequestStepId(history, approval)
    const event: WorkflowEvent = {
      type: 'APPROVAL_RESOLVED',
      ts: Date.now(),
      stepId: stepId ?? `__resolve-approval`,
      approvalId: approval.approvalId,
      approved: approval.approved,
      feedback: approval.feedback,
      meta: approval.meta,
    }
    try {
      await runStore.appendEvent(runId, history.length, event)
      emit(event)
      return { kind: 'appended' }
    } catch (err) {
      if (err instanceof LogConflictError) {
        const refreshed = await runStore.getEvents(runId)
        for (let i = history.length; i < refreshed.length; i++) {
          const e = refreshed[i]!
          if (
            e.type === 'APPROVAL_RESOLVED' &&
            (!stepId || e.stepId === stepId) &&
            e.approvalId === approval.approvalId
          ) {
            return { kind: 'idempotent' }
          }
        }
        return {
          kind: 'lost',
          code: 'approval_lost',
          message: 'Approval delivery lost: another delivery won the race.',
        }
      }
      throw err
    }
  }

  return { kind: 'appended' }
}

function findApprovalRequestStepId(
  history: ReadonlyArray<WorkflowEvent>,
  approval: ApprovalResult,
): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    const event = history[i]!
    if (
      event.type === 'APPROVAL_REQUESTED' &&
      event.approvalId === approval.approvalId
    ) {
      return event.stepId
    }
  }
  return undefined
}
