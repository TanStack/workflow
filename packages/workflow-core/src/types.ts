import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Operation } from './engine/state-diff'

// ============================================================
// Standard Schema helpers
// ============================================================

export type SchemaInput = StandardSchemaV1
export type InferSchema<T> =
  T extends StandardSchemaV1<infer _, infer Out> ? Out : never

// ============================================================
// Serialized error (wire-safe Error)
// ============================================================

export interface SerializedError {
  name: string
  message: string
  stack?: string
}

// ============================================================
// Workflow event stream (unified log entry + transport event)
// ============================================================

/**
 * The shape of every event the engine appends to a run's log.
 *
 * Two consumers, one shape:
 *
 *   - **Durability**: the engine appends events to the run's log.
 *     Replay reads the log and short-circuits primitives that have
 *     a matching CHECKPOINT event by `stepId`.
 *   - **Observability**: the engine emits the same events through
 *     `runWorkflow`'s `AsyncIterable<WorkflowEvent>` and (if wired)
 *     through stream subscribers. A browser/UI subscribes to the
 *     same log a Durable Streams URL would expose.
 *
 * Events fall into two categories internally:
 *
 *   - **Checkpoint events** — replay uses these to skip already-
 *     completed work. Indexed by `stepId`. STEP_FINISHED,
 *     STEP_FAILED, SIGNAL_RESOLVED, APPROVAL_RESOLVED, NOW_RECORDED,
 *     UUID_RECORDED, RUN_FINISHED, RUN_ERRORED.
 *
 *   - **Observability events** — engine emits but replay ignores.
 *     RUN_STARTED, STEP_STARTED, SIGNAL_AWAITED, APPROVAL_REQUESTED,
 *     STATE_DELTA, CUSTOM.
 *
 * The optional `audience` field is engine-ignored. Adapters/views
 * (e.g., a Durable Streams projection layer) may filter on it to
 * produce internal vs client vs admin views of the same log.
 */
export type WorkflowEvent =
  // ── Run lifecycle ─────────────────────────────────────────────
  | {
      type: 'RUN_STARTED'
      ts: number
      runId: string
      threadId?: string
      audience?: string
    }
  | {
      type: 'RUN_FINISHED'
      ts: number
      runId: string
      output: unknown
      audience?: string
    }
  | {
      type: 'RUN_ERRORED'
      ts: number
      runId: string
      error: SerializedError
      code: string
      audience?: string
    }
  // ── Step (durable side-effect via ctx.step) ────────────────────
  | {
      type: 'STEP_STARTED'
      ts: number
      stepId: string
      audience?: string
    }
  | {
      type: 'STEP_FINISHED'
      ts: number
      stepId: string
      result: unknown
      attempts?: ReadonlyArray<StepAttempt>
      audience?: string
    }
  | {
      type: 'STEP_FAILED'
      ts: number
      stepId: string
      error: SerializedError
      attempts?: ReadonlyArray<StepAttempt>
      audience?: string
    }
  // ── Signal (ctx.waitForEvent, ctx.sleep) ──────────────────────
  | {
      type: 'SIGNAL_AWAITED'
      ts: number
      stepId: string
      name: string
      deadline?: number
      meta?: Record<string, unknown>
      audience?: string
    }
  | {
      type: 'SIGNAL_RESOLVED'
      ts: number
      stepId: string
      name: string
      /** Host-supplied idempotency token. Same `signalId` at the
       *  same `stepId` is a no-op (idempotent retry); different
       *  `signalId` is a lost race. */
      signalId?: string
      payload: unknown
      audience?: string
    }
  // ── Approval (ctx.approve) ────────────────────────────────────
  | {
      type: 'APPROVAL_REQUESTED'
      ts: number
      stepId: string
      approvalId: string
      title: string
      description?: string
      audience?: string
    }
  | {
      type: 'APPROVAL_RESOLVED'
      ts: number
      stepId: string
      approvalId: string
      approved: boolean
      feedback?: string
      audience?: string
    }
  // ── Deterministic recording (ctx.now, ctx.uuid) ────────────────
  | {
      type: 'NOW_RECORDED'
      ts: number
      stepId: string
      value: number
      audience?: string
    }
  | {
      type: 'UUID_RECORDED'
      ts: number
      stepId: string
      value: string
      audience?: string
    }
  // ── State + custom ────────────────────────────────────────────
  | {
      type: 'STATE_DELTA'
      ts: number
      delta: ReadonlyArray<Operation>
      audience?: string
    }
  | {
      type: 'CUSTOM'
      ts: number
      name: string
      value: Record<string, unknown>
      audience?: string
    }

/** Kinds that replay treats as completion checkpoints (engine reads
 *  these from the log to short-circuit primitives). All others are
 *  observability-only. */
export type CheckpointEvent = Extract<
  WorkflowEvent,
  {
    type:
      | 'STEP_FINISHED'
      | 'STEP_FAILED'
      | 'SIGNAL_RESOLVED'
      | 'APPROVAL_RESOLVED'
      | 'NOW_RECORDED'
      | 'UUID_RECORDED'
      | 'RUN_FINISHED'
      | 'RUN_ERRORED'
  }
>

// ============================================================
// Step context (per-attempt scope inside ctx.step's fn)
// ============================================================

/**
 * Passed to a `ctx.step()` function. The deterministic `id` is the
 * idempotency-key candidate for external systems — it stays the same
 * across retries within a single step's execution AND across replays
 * of the same run.
 */
export interface StepContext {
  /** Deterministic step ID. Stable across retries and replays. */
  id: string
  /** Current attempt number (1-indexed). */
  attempt: number
  /** Per-attempt AbortSignal. Fires on:
   *   - step timeout firing
   *   - run-level abort (Ctrl+C / external cancellation) */
  signal: AbortSignal
}

export interface StepRetryOptions {
  /** Maximum total attempts including the first try. Must be >= 1. */
  maxAttempts: number
  /** Backoff between attempts. Default: 'exponential'. */
  backoff?: 'exponential' | 'fixed' | ((attempt: number) => number)
  /** Base delay in ms for built-in backoff strategies. Default: 500. */
  baseMs?: number
  /** Predicate to decide whether a given error should be retried.
   *  Default: retry every error. */
  shouldRetry?: (err: unknown, attempt: number) => boolean
}

export interface StepOptions {
  retry?: StepRetryOptions
  /** Per-attempt timeout in ms. */
  timeout?: number
}

export interface StepAttempt {
  startedAt: number
  finishedAt: number
  result?: unknown
  error?: SerializedError
}

// ============================================================
// Wait-for-event / approve options
// ============================================================

export interface WaitForEventOptions<TPayload = unknown> {
  /** UTC ms wake deadline. Surfaced on `RunState.waitingFor.deadline`
   *  so hosts can build time-indexed worker jobs. */
  deadline?: number
  /** Free-form metadata the host or UI may render. */
  meta?: Record<string, unknown>
  /** Optional schema for validating the incoming payload before
   *  resuming the workflow. */
  schema?: StandardSchemaV1<unknown, TPayload>
}

export interface ApproveOptions {
  title: string
  description?: string
}

export interface ApprovalResult {
  approved: boolean
  approvalId: string
  feedback?: string
}

// ============================================================
// Ctx — the single argument to every workflow handler
// ============================================================

/** Built-in fields on every ctx. Middleware can add fields via the
 *  `TExtensions` generic but cannot shadow these. */
export interface BaseCtx<TInput, TState> {
  runId: string
  input: TInput
  state: TState
  /** AbortSignal for the run as a whole. */
  signal: AbortSignal

  // ── Durable primitives (replay-aware) ────────────────────────
  step: <T>(
    id: string,
    fn: (stepCtx: StepContext) => T | Promise<T>,
    options?: StepOptions,
  ) => Promise<T>
  sleep: (ms: number) => Promise<void>
  sleepUntil: (timestamp: number) => Promise<void>
  waitForEvent: <TPayload = unknown>(
    name: string,
    options?: WaitForEventOptions<TPayload>,
  ) => Promise<TPayload>
  approve: (options: ApproveOptions) => Promise<ApprovalResult>
  now: () => Promise<number>
  uuid: () => Promise<string>

  // ── Observability ─────────────────────────────────────────────
  /** Emit a CUSTOM event for UI/devtools consumption. Does not enter
   *  the replay log. */
  emit: (name: string, value: Record<string, unknown>) => void
}

/** Reserved field names that middleware may not override. */
export type ReservedCtxFields =
  | 'runId'
  | 'input'
  | 'state'
  | 'signal'
  | 'step'
  | 'sleep'
  | 'sleepUntil'
  | 'waitForEvent'
  | 'approve'
  | 'now'
  | 'uuid'
  | 'emit'

/** Full ctx type passed to a handler, including middleware-added
 *  fields. `TExtensions` defaults to `unknown` so the empty-middleware
 *  case collapses cleanly under intersection
 *  (`unknown & BaseCtx === BaseCtx`). */
export type Ctx<
  TInput = unknown,
  TState = Record<string, unknown>,
  TExtensions = unknown,
> = BaseCtx<TInput, TState> & TExtensions

/**
 * Helper alias for typing functions that only care about middleware
 * extensions — not the calling workflow's specific input / state
 * shape. Common in shared utility helpers:
 *
 *     async function chargeUser(
 *       ctx: WorkflowCtx<{ user: User }>,
 *       amount: number,
 *     ) {
 *       return ctx.step('charge', () => stripe.charge(amount, ctx.user.id))
 *     }
 *
 * For helpers that need typed `ctx.input` or `ctx.state`, use the
 * full `Ctx<TInput, TState, TExt>` directly.
 */
export type WorkflowCtx<TExtensions = unknown> = Ctx<any, any, TExtensions>

// ============================================================
// Middleware
// ============================================================

/**
 * A middleware extends the ctx for downstream middleware + the
 * handler. The function receives the *current* `ctx` and a `next`
 * callable taking `{ context: TExtension }` — the literal `context`
 * field is what TypeScript anchors on to infer `TExtension` from the
 * call site.
 *
 *     const requireUser = createMiddleware().server(async ({ ctx, next }) => {
 *       const user = await loadUser()
 *       return next({ context: { user } })
 *       // downstream ctx is now `prev & { user: User }`
 *     })
 */
export type MiddlewareServerFn<TCtxIn, TExtension> = (args: {
  ctx: TCtxIn
  next: (opts: { context: TExtension }) => Promise<unknown>
}) => Promise<unknown>

export interface Middleware<TCtxIn = unknown, TExtension = unknown> {
  __kind: 'middleware'
  server: MiddlewareServerFn<TCtxIn, TExtension>
}

export type AnyMiddleware = Middleware<any, any>

// ============================================================
// Workflow definition
// ============================================================

export interface WorkflowDefinition<
  TInput = unknown,
  TOutput = unknown,
  TState = Record<string, unknown>,
> {
  __kind: 'workflow'
  id: string
  description?: string
  /** Caller-supplied version identifier. Used with `previousVersions`
   *  and `selectWorkflowVersion` for cross-version routing. */
  version?: string
  /** Older versions of this workflow that may still have in-flight
   *  runs. The engine routes a run's resume call to the version whose
   *  identifier matches the run's persisted `workflowVersion`. */
  previousVersions?: ReadonlyArray<WorkflowDefinition<any, any, any>>
  inputSchema?: SchemaInput
  outputSchema?: SchemaInput
  stateSchema?: SchemaInput
  initialize?: (args: { input: TInput }) => Partial<TState>
  defaultStepRetry?: StepRetryOptions
  middlewares: ReadonlyArray<AnyMiddleware>
  handler: (ctx: Ctx<TInput, TState, any>) => Promise<TOutput>
}

export type AnyWorkflowDefinition = WorkflowDefinition<any, any, any>

// ============================================================
// Inference helpers — extract the typed shape of an existing
// workflow for consumers (clients, tests, downstream types).
// ============================================================

export type WorkflowInput<TDefinition> =
  TDefinition extends WorkflowDefinition<infer TInput, any, any>
    ? TInput
    : never

export type WorkflowOutput<TDefinition> =
  TDefinition extends WorkflowDefinition<any, infer TOutput, any>
    ? TOutput
    : never

export type WorkflowState<TDefinition> =
  TDefinition extends WorkflowDefinition<any, any, infer TState>
    ? TState
    : never

// ============================================================
// Signal delivery (used by resume calls)
// ============================================================

export interface SignalDelivery<TPayload = unknown> {
  /** Idempotency token. Same signalId at the same stepId = no-op
   *  retry; different signalId = lost race. */
  signalId: string
  /** Name of the awaited signal (the same name passed to
   *  `ctx.waitForEvent(name, ...)`). */
  name: string
  payload: TPayload
}

// ============================================================
// Run state (persistence shape — minimal; state itself is derived)
// ============================================================

export type RunStatus =
  | 'running'
  | 'paused'
  | 'finished'
  | 'errored'
  | 'aborted'

/**
 * Persisted run metadata. State is intentionally NOT stored here —
 * it is reconstructed from `initialize(input)` + log replay on every
 * resume. The store only persists what's needed to route, resume,
 * and audit a run.
 */
export interface RunState<TInput = unknown, TOutput = unknown> {
  runId: string
  status: RunStatus
  workflowId: string
  workflowVersion?: string
  input: TInput
  output?: TOutput
  error?: SerializedError
  /** Set when the run is paused awaiting an external signal. */
  waitingFor?: {
    signalName: string
    deadline?: number
    meta?: Record<string, unknown>
  }
  /** Set when the run is paused awaiting an approval. */
  pendingApproval?: {
    approvalId: string
    title: string
    description?: string
  }
  createdAt: number
  updatedAt: number
}

// ============================================================
// RunStore — backing storage (state + append-only log + CAS)
// ============================================================

export type DeleteReason = 'finished' | 'errored' | 'aborted'

/**
 * Pluggable backing store for workflow runs.
 *
 * Two surfaces:
 *
 *   - **State** (`getRunState` / `setRunState` / `deleteRun`) —
 *     low-frequency metadata writes (status, output, pause info).
 *     State the user mutates inside the handler is NOT persisted
 *     here; it's reconstructed from log replay.
 *
 *   - **Event log** (`appendEvent` / `getEvents`) — append-only
 *     with optimistic CAS on `expectedNextIndex`. Each entry is a
 *     `WorkflowEvent`. Used for both replay (engine reads
 *     checkpoint events back) and transport (UI subscribers tail
 *     the log).
 *
 * Stores that support push-based subscription (in-memory, Redis
 * pub/sub, Postgres LISTEN/NOTIFY, Durable Streams) should
 * implement `subscribe` so callers can tail a run live without
 * polling.
 */
export interface RunStore {
  // ── State (metadata snapshot) ──────────────────────────────────
  getRunState: (runId: string) => Promise<RunState | undefined>
  setRunState: (runId: string, state: RunState) => Promise<void>
  deleteRun: (runId: string, reason: DeleteReason) => Promise<void>

  // ── Event log (append-only, CAS) ──────────────────────────────
  /** Append `event` at `expectedNextIndex`. Throws `LogConflictError`
   *  if another writer has already committed at that index. Must be
   *  atomic. */
  appendEvent: (
    runId: string,
    expectedNextIndex: number,
    event: WorkflowEvent,
  ) => Promise<void>
  /** Read every event for `runId`, ordered by append position. */
  getEvents: (runId: string) => Promise<ReadonlyArray<WorkflowEvent>>

  // ── Optional subscription (push-based tailing) ────────────────
  /** Subscribe to new events for `runId`. Returns an unsubscribe
   *  function. Stores without push support omit this and callers
   *  fall back to polling `getEvents`. */
  subscribe?: (
    runId: string,
    fromIndex: number,
    onEvent: (event: WorkflowEvent, index: number) => void,
  ) => () => void
}

// ============================================================
// Errors
// ============================================================

/**
 * Thrown by `RunStore.appendEvent` when another writer has already
 * committed a record at the requested index. The engine catches it
 * and decides whether to treat as idempotent (same signalId) or as
 * a lost race (different signalId).
 */
export class LogConflictError extends Error {
  override readonly name = 'LogConflictError'
  constructor(
    public readonly runId: string,
    public readonly attemptedIndex: number,
    public readonly existing?: WorkflowEvent,
  ) {
    super(
      `Log conflict for run ${runId} at index ${attemptedIndex}: another writer has already committed.`,
    )
  }
}

/** Thrown when a `ctx.step()` with `{ timeout }` exceeds its
 *  wall-clock budget on a given attempt. */
export class StepTimeoutError extends Error {
  override readonly name = 'StepTimeoutError'
  constructor(
    public readonly stepId: string,
    public readonly timeoutMs: number,
  ) {
    super(`Step "${stepId}" exceeded ${timeoutMs}ms timeout.`)
  }
}

/** Internal sentinel: thrown by a paused primitive to unwind the
 *  handler stack. The engine catches it and marks the run as
 *  paused. User code should not catch this. */
export class WorkflowPaused extends Error {
  override readonly name = 'WorkflowPaused'
  constructor() {
    super('Workflow paused — this error is for engine use only.')
  }
}
