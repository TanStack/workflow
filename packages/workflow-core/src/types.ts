import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Operation } from './engine/state-diff'

// ==========================================
// Standard Schema helpers
// ==========================================

export type SchemaInput = StandardSchemaV1
export type InferSchema<T> =
  T extends StandardSchemaV1<infer _, infer Out> ? Out : never

// ==========================================
// Workflow event stream
// ==========================================

/**
 * Discriminated union emitted by `runWorkflow` for downstream consumers
 * (HTTP/SSE handlers, devtools, in-process listeners). Designed to be
 * a structural superset of AG-UI's RUN, STEP, and STATE event shapes
 * so higher layers (e.g. `@tanstack/ai-orchestration`) can adapt these
 * to AG-UI without translation.
 */
export type WorkflowEvent =
  | {
      type: 'RUN_STARTED'
      timestamp: number
      runId: string
      threadId: string
    }
  | {
      type: 'RUN_FINISHED'
      timestamp: number
      runId: string
      threadId: string
      output?: unknown
    }
  | {
      type: 'RUN_ERROR'
      timestamp: number
      runId: string
      threadId: string
      message: string
      code: string
    }
  | {
      type: 'STEP_STARTED'
      timestamp: number
      stepId: string
      stepName: string
      stepType?: StepKind
    }
  | {
      type: 'STEP_FINISHED'
      timestamp: number
      stepId: string
      stepName: string
      content?: unknown
    }
  | { type: 'STATE_SNAPSHOT'; timestamp: number; snapshot: unknown }
  | { type: 'STATE_DELTA'; timestamp: number; delta: Array<Operation> }
  | {
      type: 'CUSTOM'
      timestamp: number
      name: string
      value: Record<string, unknown>
    }

// ==========================================
// Workflow definition
// ==========================================

export type WorkflowRunArgs<TInput, TState> = {
  input: TInput
  state: TState
  emit: EmitFn
  signal: AbortSignal
}

export interface WorkflowDefinition<
  TInputSchema extends SchemaInput | undefined,
  TOutputSchema extends SchemaInput | undefined,
  TStateSchema extends SchemaInput | undefined,
> {
  __kind: 'workflow'
  name: string
  description?: string
  /**
   * Caller-supplied version identifier. Hosts running multiple
   * workflow versions side-by-side use this with
   * `selectWorkflowVersion` to route resume calls to the version a
   * given run was started under.
   */
  version?: string
  inputSchema?: TInputSchema
  outputSchema?: TOutputSchema
  stateSchema?: TStateSchema
  /**
   * Migration patch list. Each entry is a string name that user code
   * gates on via `yield* patched(name)`. Declaring `patches` switches
   * this workflow into the lighter "patch-versioned" fingerprint
   * mode: code-body changes no longer trigger
   * `workflow_version_mismatch`; instead the engine checks that the
   * run's recorded patches are a subset of the current workflow's
   * patches. Workflows without `patches` get the strict source-hash
   * fingerprint (unchanged).
   *
   * Note: this primitive is slated for deprecation in favor of
   * explicit versioning (`version` + a planned `previousVersions`
   * registry). See the project design docs.
   */
  patches?: ReadonlyArray<string>
  initialize?: (args: {
    input: TInputSchema extends SchemaInput
      ? InferSchema<TInputSchema>
      : unknown
  }) => TStateSchema extends SchemaInput
    ? Partial<InferSchema<TStateSchema>>
    : Record<string, unknown>
  /** Fallback retry policy for `step()` calls that don't carry their
   *  own `{ retry }` option. */
  defaultStepRetry?: StepRetryOptions
  run: (
    args: WorkflowRunArgs<
      TInputSchema extends SchemaInput ? InferSchema<TInputSchema> : unknown,
      TStateSchema extends SchemaInput
        ? InferSchema<TStateSchema>
        : Record<string, unknown>
    >,
  ) => AsyncGenerator<
    StepDescriptor,
    TOutputSchema extends SchemaInput ? InferSchema<TOutputSchema> : unknown,
    unknown
  >
}

export type AnyWorkflowDefinition = WorkflowDefinition<any, any, any>

// ==========================================
// Step descriptors
// ==========================================

/** Context handed to a `step()` function. The deterministic `id` is the
 *  one to use as an idempotency key against external systems — it stays
 *  the same across replays of the same step, so e.g. a retried
 *  `step('charge', ctx => stripe.charges.create({...}, {idempotencyKey: ctx.id}))`
 *  won't double-charge if the engine replays the step. */
export interface StepContext {
  /** Deterministic step ID. Stable across replays. */
  id: string
  /** Current attempt number (1-indexed). Useful for retry-aware step
   *  fns that want to e.g. widen a timeout on later attempts. */
  attempt: number
  /**
   * Per-attempt AbortSignal. Aborts when:
   *   - the step's `timeout` (if any) elapses for the current attempt
   *   - the run as a whole is aborted (Ctrl+C / external cancellation)
   * Wire it into your fetch/axios/db client so timeouts and run-level
   * cancels actually halt the in-flight work instead of letting it
   * burn through.
   */
  signal: AbortSignal
}

/**
 * Per-step retry policy. When set on a `step()` call (or via the
 * workflow's `defaultStepRetry`), the engine retries the step's `fn`
 * until it succeeds or `maxAttempts` is exhausted. Backoff between
 * attempts uses an in-process timer — durable across yields but not
 * across process restart, an acceptable v1 limitation.
 */
export interface StepRetryOptions {
  /** Maximum total attempts including the first try. Must be >= 1. */
  maxAttempts: number
  /**
   * Backoff strategy between attempts.
   *   - `'exponential'`  — `baseMs * 2^(attempt-1)` ms.
   *   - `'fixed'`        — always `baseMs`.
   *   - `(attempt) => ms` — custom function.
   * Default: `'exponential'`.
   */
  backoff?: 'exponential' | 'fixed' | ((attempt: number) => number)
  /** Base delay in ms for built-in backoff strategies. Default: 500. */
  baseMs?: number
  /**
   * Predicate to decide whether a given error should be retried. If
   * absent, every thrown error is retried until attempts are
   * exhausted. Return `false` to abort retries early.
   */
  shouldRetry?: (err: unknown, attempt: number) => boolean
}

export type StepDescriptor =
  | {
      kind: 'nested-workflow'
      name: string
      input: unknown
      workflow: AnyWorkflowDefinition
    }
  | { kind: 'approval'; title: string; description?: string }
  | {
      kind: 'step'
      name: string
      fn: (ctx: StepContext) => unknown | Promise<unknown>
      retry?: StepRetryOptions
      /** Per-attempt timeout in ms. A timeout surfaces as a
       *  `StepTimeoutError` thrown from the yield. Use the retry
       *  policy's `shouldRetry` to decide whether timeouts should
       *  retry — by default they do, up to `maxAttempts`. */
      timeout?: number
    }
  | { kind: 'now' }
  | { kind: 'uuid' }
  | {
      /** Temporal-style mid-flight migration flag. Returns `true` for
       *  runs that were started under a workflow version that declared
       *  this patch, `false` for runs started before the patch was
       *  added. */
      kind: 'patched'
      name: string
    }
  | {
      /** Generic durable pause: the run yields a named signal, the
       *  engine persists `waitingFor`, the event stream closes, and the
       *  host resumes the run by delivering a payload for `name`.
       *  Sleep/sleepUntil are built on this with the reserved name
       *  `'__timer'`; user-defined waits use plain names. */
      kind: 'signal'
      name: string
      /** Wake deadline in UTC ms. Surfaced on
       *  `waitingFor.deadline` so hosts can build time-driven indexes
       *  (cron, scheduled jobs) over the persisted state. */
      deadline?: number
      /** Free-form metadata the host or UI may render. Opaque to the
       *  engine. */
      meta?: Record<string, unknown>
    }

// TNext is `any` so a generator with TReturn=A can `yield*` another generator
// with TReturn=B without TS rejecting the delegation. The engine sends the
// correct typed value back at each yield boundary; the type of the value is
// determined by the inner generator (e.g., `step(...)` returns a step result,
// `approve(...)` returns an `ApprovalResult`).
export type StepGenerator<T> = Generator<StepDescriptor, T, any>

// ==========================================
// Approval result
// ==========================================

export interface ApprovalResult {
  approved: boolean
  approvalId: string
  /** Optional free-text feedback. Set when the user denies and asks for revisions. */
  feedback?: string
}

// ==========================================
// Emit
// ==========================================

export type EmitFn = (name: string, value: Record<string, unknown>) => void

// ==========================================
// Run state
// ==========================================

export type RunStatus = 'running' | 'paused' | 'finished' | 'error' | 'aborted'

export interface RunState<
  TInput = unknown,
  TState = unknown,
  TOutput = unknown,
> {
  runId: string
  status: RunStatus
  workflowName: string
  /**
   * Caller-supplied version identifier (e.g. 'v1', '2026-05-15') copied
   * from the workflow definition at run start.
   */
  workflowVersion?: string
  /**
   * Stable hash of the workflow's source. Computed once at run start,
   * persisted with state, and compared on every replay-from-store
   * resume. A mismatch refuses resume with `RUN_ERROR { code:
   * 'workflow_version_mismatch' }` rather than blindly driving a fresh
   * generator through a log whose positional indices may not line up.
   *
   * Slated for replacement by explicit `previousVersions` routing in a
   * subsequent design pass.
   */
  fingerprint?: string
  /**
   * Patches the workflow declared at the moment this run was started.
   * `yield* patched(name)` returns `startingPatches.includes(name)`.
   * Persisted so the answer stays stable across replays.
   */
  startingPatches?: ReadonlyArray<string>
  input: TInput
  state: TState
  output?: TOutput
  error?: { name: string; message: string; stack?: string }
  pendingApproval?: { approvalId: string; title: string; description?: string }
  /**
   * Signal-pause descriptor — set when the engine pauses on a
   * `waitForSignal`. An out-of-process worker (cron, message-bus
   * consumer) can independently discover the pending wake by querying
   * the store. Hosts typically build indexes on
   * `(waitingFor.signalName, waitingFor.deadline)` for time-driven and
   * signal-driven wake jobs respectively.
   */
  waitingFor?: {
    signalName: string
    deadline?: number
    meta?: Record<string, unknown>
  }
  createdAt: number
  updatedAt: number
}

/**
 * Delivered to a paused signal-wait. The `signalId` is the host's
 * idempotency token for this delivery — the engine persists it on the
 * resulting step record and dedupes duplicate deliveries (same
 * signalId, same step index) by returning the recorded payload.
 */
export interface SignalResult<TPayload = unknown> {
  signalId: string
  payload: TPayload
}

// ==========================================
// Step log
// ==========================================

/**
 * Discriminator for entries in a run's step log. The engine appends one
 * StepRecord per checkpoint boundary in the workflow. Replay short-
 * circuits each yield by reading the recorded record at the matching
 * positional index. Adapter authors persisting this enum should treat
 * unknown kinds as opaque (forward-compat for primitives added in later
 * releases, or for kinds introduced by packages that build on top of
 * the core engine).
 */
export type StepKind =
  | 'step'
  | 'approval'
  | 'nested-workflow'
  | 'now'
  | 'uuid'
  | 'patched'
  | 'signal'

/** One attempt of a step, including retries. The terminal attempt is the
 *  one whose result/error becomes the StepRecord's result/error. */
export interface StepAttempt {
  startedAt: number
  finishedAt: number
  /** Set when the attempt succeeded. */
  result?: unknown
  /** Set when the attempt threw. */
  error?: { name: string; message: string; stack?: string }
}

/**
 * Persisted record of a single checkpoint in a run. Append-only — once
 * written at a given (runId, index) it must not be mutated. Step results
 * are the authoritative truth for replay; if state diverges from what
 * replaying the log would produce, log wins.
 */
export interface StepRecord {
  /** Positional index in the run's log, starting at 0. */
  index: number
  /** What kind of step produced this record. */
  kind: StepKind
  /** Step identity used for UI / debugging: `step()` name, signal
   *  name, etc. */
  name: string
  /**
   * Producer ID — populated for entries created from external signals
   * (approval, generic signal). Engine uses it to dedupe idempotent
   * retries of the same signal delivery: a second `appendStep` call
   * with the same `signalId` at the same index returns the existing
   * record instead of throwing LogConflictError.
   */
  signalId?: string
  /** Set when the step succeeded. `undefined` for void-returning kinds. */
  result?: unknown
  /** Set when the step failed and user code did not catch the throw. */
  error?: { name: string; message: string; stack?: string }
  startedAt: number
  finishedAt?: number
  /** Recorded per-attempt detail for steps with a retry policy. The
   *  terminal entry's outcome lives on `result` / `error`. */
  attempts?: ReadonlyArray<StepAttempt>
}

/**
 * Thrown when a `step()` with `{ timeout }` exceeds its wall-clock
 * budget on a given attempt. Subject to the retry policy.
 */
export class StepTimeoutError extends Error {
  override readonly name = 'StepTimeoutError'
  constructor(
    public readonly stepName: string,
    public readonly timeoutMs: number,
  ) {
    super(`Step "${stepName}" exceeded ${timeoutMs}ms timeout.`)
  }
}

/**
 * Thrown by `RunStore.appendStep` when another writer has already
 * committed a record at the requested index. The engine catches it,
 * re-reads the log, and either:
 *  - returns the conflicting record (idempotent — same signalId means
 *    it was a retry of the same delivery), or
 *  - surfaces `RUN_ERROR { code: 'signal_lost', winner }` (a genuinely
 *    different writer won the race).
 *
 * Store implementations must throw this exact class so the engine can
 * distinguish CAS failure from other store errors.
 */
export class LogConflictError extends Error {
  override readonly name = 'LogConflictError'
  constructor(
    public readonly runId: string,
    public readonly attemptedIndex: number,
    /** The record already at that index, if the store can cheaply
     *  surface it. */
    public readonly existing?: StepRecord,
  ) {
    super(
      `Log conflict for run ${runId} at index ${attemptedIndex}: another writer has already committed.`,
    )
  }
}

// ==========================================
// RunStore
// ==========================================

export type DeleteReason = 'finished' | 'error' | 'aborted'

/**
 * Pluggable backing store for workflow runs.
 *
 * Two concerns, kept deliberately separate:
 *
 * - **State** (`getRunState` / `setRunState` / `deleteRun`) is the
 *   *materialized view*. Holds the current snapshot — status, input,
 *   user-defined state, output, error, pause info. Written on each
 *   meaningful transition. Low frequency, snapshot writes. If state is
 *   missing or torn after a crash, the engine reconstructs it by
 *   replaying the log.
 *
 * - **Step log** (`appendStep` / `getSteps`) is the *authoritative
 *   source of truth*. Append-only. Each entry records one checkpoint
 *   boundary in the run.
 *
 * `appendStep` is optimistic-CAS: writers pass `expectedNextIndex`, and
 * the store must reject the append (by throwing `LogConflictError`) if
 * a record already exists at that index. The conditional check and the
 * insert must be a single atomic operation on the backing system
 * (Postgres `INSERT ... WHERE NOT EXISTS`, DynamoDB
 * `ConditionExpression`, Redis `WATCH`/multi, etc.). Backends that
 * can't enforce atomic CAS are unsuitable for multi-instance
 * deployments.
 *
 * No transactional contract is required *between* state and log writes —
 * the engine writes log entries before any state mutation that depends
 * on them, and replay guarantees state correctness from the log alone.
 */
export interface RunStore {
  // ── state (snapshot) ───────────────────────────────────────────────
  getRunState: (runId: string) => Promise<RunState | undefined>
  setRunState: (runId: string, state: RunState) => Promise<void>
  deleteRun: (runId: string, reason: DeleteReason) => Promise<void>

  // ── step log (append-only, CAS) ────────────────────────────────────
  /**
   * Append `record` at `expectedNextIndex`. Throws `LogConflictError`
   * if another writer has already committed at that index. Must be
   * atomic.
   */
  appendStep: (
    runId: string,
    expectedNextIndex: number,
    record: StepRecord,
  ) => Promise<void>
  /** Read every record for `runId`, ordered by `index` ascending. */
  getSteps: (runId: string) => Promise<ReadonlyArray<StepRecord>>
}

// ==========================================
// Engine-internal: live (non-serializable) run handle
// ==========================================
export interface LiveRun {
  runState: RunState
  generator: AsyncGenerator<StepDescriptor, unknown, unknown>
  abortController: AbortController
  approvalResolver?: (result: ApprovalResult) => void
  pendingEvents: Array<WorkflowEvent>
  /** Step ID of the currently paused approval/signal, if any. Used to
   *  emit STEP_FINISHED on resume. */
  pendingApprovalStepId?: string
}
