import type {
  AnyWorkflowDefinition,
  ApprovalResult,
  DeleteReason,
  RunState,
  RunStatus,
  RunStore,
  SerializedError,
  SignalDelivery,
  WorkflowEvent,
} from '@tanstack/workflow-core'

export type WorkflowId = string
export type WorkflowVersion = string
export type RunId = string
export type ScheduleId = string
export type ScheduleBucketId = string
export type LeaseOwner = string

export type WorkflowExecutionStatus = RunStatus | 'queued'

export interface WorkflowLease {
  owner: LeaseOwner
  expiresAt: number
}

export interface WorkflowExecution {
  runId: RunId
  workflowId: WorkflowId
  workflowVersion?: WorkflowVersion
  status: WorkflowExecutionStatus
  input: unknown
  output?: unknown
  error?: SerializedError
  awaiting?: RunState['awaiting']
  waitingFor?: RunState['waitingFor']
  pendingApproval?: RunState['pendingApproval']
  wakeAt?: number
  lease?: WorkflowLease
  createdAt: number
  updatedAt: number
}

export interface StoredWorkflowEvent {
  runId: RunId
  eventIndex: number
  eventType: WorkflowEvent['type']
  stepId?: string
  event: WorkflowEvent
  createdAt: number
}

export interface LoadedExecution {
  run: WorkflowExecution
  events: ReadonlyArray<StoredWorkflowEvent>
}

export interface CreateRunArgs {
  runId: RunId
  workflowId: WorkflowId
  workflowVersion?: WorkflowVersion
  input: unknown
  now: number
}

export type CreateRunResult =
  | { kind: 'created'; run: WorkflowExecution }
  | { kind: 'existing'; run: WorkflowExecution }

export interface ReadEventsArgs {
  runId: RunId
  fromIndex?: number
}

export interface AppendEventsArgs {
  runId: RunId
  expectedNextIndex: number
  events: ReadonlyArray<WorkflowEvent>
}

export interface AppendEventsResult {
  nextIndex: number
}

export interface ClaimRunArgs {
  runId: RunId
  leaseOwner: LeaseOwner
  leaseMs: number
  now: number
}

export type ClaimRunResult =
  | { kind: 'claimed'; run: WorkflowExecution }
  | { kind: 'not-found' }
  | { kind: 'not-claimable'; run: WorkflowExecution }

export interface HeartbeatRunLeaseArgs {
  runId: RunId
  leaseOwner: LeaseOwner
  leaseMs: number
  now: number
}

export interface ReleaseRunLeaseArgs {
  runId: RunId
  leaseOwner: LeaseOwner
}

export interface MarkRunPausedArgs {
  runId: RunId
  awaiting?: RunState['awaiting']
  waitingFor?: RunState['waitingFor']
  pendingApproval?: RunState['pendingApproval']
  wakeAt?: number
  now: number
}

export interface MarkRunFinishedArgs {
  runId: RunId
  output: unknown
  now: number
}

export interface MarkRunErroredArgs {
  runId: RunId
  error: SerializedError
  code: string
  now: number
}

export interface ScheduleTimerArgs {
  runId: RunId
  workflowId: WorkflowId
  workflowVersion?: WorkflowVersion
  wakeAt: number
  signalId: string
  now: number
}

export interface ClaimDueTimersArgs {
  now: number
  limit: number
  leaseOwner: LeaseOwner
  leaseMs: number
}

export interface TimerWakeup {
  runId: RunId
  workflowId: WorkflowId
  workflowVersion?: WorkflowVersion
  wakeAt: number
  signalId: string
}

export interface DeliverSignalArgs<TPayload = unknown> {
  runId: RunId
  delivery: SignalDelivery<TPayload>
  now: number
}

export type DeliverSignalResult =
  | { kind: 'delivered'; run: WorkflowExecution }
  | { kind: 'duplicate'; run: WorkflowExecution }
  | { kind: 'not-waiting'; run: WorkflowExecution }
  | { kind: 'not-found' }

export interface DeliverApprovalArgs {
  runId: RunId
  approval: ApprovalResult
  now: number
}

export type DeliverApprovalResult =
  | { kind: 'delivered'; run: WorkflowExecution }
  | { kind: 'duplicate'; run: WorkflowExecution }
  | { kind: 'not-waiting'; run: WorkflowExecution }
  | { kind: 'not-found' }

export type WorkflowOverlapPolicy =
  | 'skip'
  | 'allow'
  | 'buffer-one'
  | 'cancel-previous'
  | 'terminate-previous'

export type WorkflowScheduleSpec =
  | {
      kind: 'cron'
      expression: string
      timezone?: string
    }
  | {
      kind: 'interval'
      everyMs: number
      timezone?: string
    }

export interface WorkflowScheduleDefinition {
  id?: ScheduleId
  schedule: WorkflowScheduleSpec
  overlapPolicy?: WorkflowOverlapPolicy
  input?: unknown | (() => unknown | Promise<unknown>)
  enabled?: boolean
}

export interface UpsertScheduleArgs {
  scheduleId: ScheduleId
  workflowId: WorkflowId
  workflowVersion?: WorkflowVersion
  schedule: WorkflowScheduleSpec
  overlapPolicy: WorkflowOverlapPolicy
  input?: unknown
  nextFireAt?: number
  enabled: boolean
  now: number
}

export interface ClaimDueScheduleBucketsArgs {
  now: number
  limit: number
  leaseOwner: LeaseOwner
  leaseMs: number
}

export interface ScheduleBucket {
  scheduleId: ScheduleId
  bucketId: ScheduleBucketId
  workflowId: WorkflowId
  workflowVersion?: WorkflowVersion
  runId: RunId
  fireAt: number
  input: unknown
  overlapPolicy: WorkflowOverlapPolicy
}

export interface MarkScheduleBucketStartedArgs {
  scheduleId: ScheduleId
  bucketId: ScheduleBucketId
  runId: RunId
  now: number
}

export interface ClaimStaleRunsArgs {
  now: number
  limit: number
  leaseOwner: LeaseOwner
  leaseMs: number
}

export interface RunClaim {
  run: WorkflowExecution
  lease: WorkflowLease
}

export interface ListRunsArgs {
  workflowId?: WorkflowId
  status?: WorkflowExecutionStatus
  limit: number
  cursor?: string
}

export interface RunSummary {
  runId: RunId
  workflowId: WorkflowId
  workflowVersion?: WorkflowVersion
  status: WorkflowExecutionStatus
  awaiting?: RunState['awaiting']
  waitingFor?: RunState['waitingFor']
  pendingApproval?: RunState['pendingApproval']
  wakeAt?: number
  createdAt: number
  updatedAt: number
}

export interface RunTimeline {
  run: WorkflowExecution
  events: ReadonlyArray<StoredWorkflowEvent>
}

export interface SaveRunStateArgs {
  state: RunState
}

export interface WorkflowRunStoreAdapterStore {
  loadRunState: (runId: RunId) => Promise<RunState | undefined>
  saveRunState: (args: SaveRunStateArgs) => Promise<void>
  deleteRun: (runId: RunId, reason: DeleteReason) => Promise<void>
  appendEvents: (args: AppendEventsArgs) => Promise<AppendEventsResult>
  readEvents: (
    args: ReadEventsArgs,
  ) => Promise<ReadonlyArray<StoredWorkflowEvent>>
  subscribeEvents?: (
    runId: RunId,
    fromIndex: number,
    onEvent: (event: WorkflowEvent, index: number) => void,
  ) => () => void
}

export type WorkflowRunStoreAdapter = RunStore

export interface WorkflowExecutionStore extends WorkflowRunStoreAdapterStore {
  createRun: (args: CreateRunArgs) => Promise<CreateRunResult>
  loadRun: (runId: RunId) => Promise<WorkflowExecution | undefined>
  loadExecution: (runId: RunId) => Promise<LoadedExecution | undefined>

  claimRun: (args: ClaimRunArgs) => Promise<ClaimRunResult>
  heartbeatRunLease: (args: HeartbeatRunLeaseArgs) => Promise<void>
  releaseRunLease: (args: ReleaseRunLeaseArgs) => Promise<void>
  markRunPaused: (args: MarkRunPausedArgs) => Promise<void>
  markRunFinished: (args: MarkRunFinishedArgs) => Promise<void>
  markRunErrored: (args: MarkRunErroredArgs) => Promise<void>

  scheduleTimer: (args: ScheduleTimerArgs) => Promise<void>
  claimDueTimers: (
    args: ClaimDueTimersArgs,
  ) => Promise<ReadonlyArray<TimerWakeup>>
  deliverSignal: <TPayload = unknown>(
    args: DeliverSignalArgs<TPayload>,
  ) => Promise<DeliverSignalResult>
  deliverApproval: (args: DeliverApprovalArgs) => Promise<DeliverApprovalResult>

  upsertSchedule: (args: UpsertScheduleArgs) => Promise<void>
  claimDueScheduleBuckets: (
    args: ClaimDueScheduleBucketsArgs,
  ) => Promise<ReadonlyArray<ScheduleBucket>>
  markScheduleBucketStarted: (
    args: MarkScheduleBucketStartedArgs,
  ) => Promise<void>

  claimStaleRuns: (args: ClaimStaleRunsArgs) => Promise<ReadonlyArray<RunClaim>>
  listRuns: (args: ListRunsArgs) => Promise<ReadonlyArray<RunSummary>>
  getRunTimeline: (runId: RunId) => Promise<RunTimeline | undefined>
}

export type WorkflowLoaderResult<
  TWorkflow extends AnyWorkflowDefinition = AnyWorkflowDefinition,
> = TWorkflow | { default: TWorkflow } | { workflow: TWorkflow }

export type WorkflowLoader<
  TWorkflow extends AnyWorkflowDefinition = AnyWorkflowDefinition,
> = () => Promise<WorkflowLoaderResult<TWorkflow>>

export interface WorkflowRegistration<
  TWorkflow extends AnyWorkflowDefinition = AnyWorkflowDefinition,
> {
  load: WorkflowLoader<TWorkflow>
  version?: WorkflowVersion
  previousVersions?: Record<WorkflowVersion, WorkflowLoader>
  schedules?: ReadonlyArray<WorkflowScheduleDefinition>
}

export type WorkflowRegistrationMap = Record<string, WorkflowRegistration>

export interface WorkflowRuntimeConfig<
  TWorkflows extends WorkflowRegistrationMap = WorkflowRegistrationMap,
> {
  workflows: TWorkflows
  store: WorkflowExecutionStore
  defaultLeaseMs?: number
}

export interface WorkflowRuntimeDefinition<
  TWorkflows extends WorkflowRegistrationMap = WorkflowRegistrationMap,
> extends WorkflowRuntimeConfig<TWorkflows> {
  __kind: 'workflow-runtime'
  startRun: (
    args: WorkflowRuntimeStartRunArgs,
  ) => Promise<WorkflowRuntimeRunResult>
  deliverSignal: <TPayload = unknown>(
    args: WorkflowRuntimeDeliverSignalArgs<TPayload>,
  ) => Promise<WorkflowRuntimeRunResult>
  deliverApproval: (
    args: WorkflowRuntimeDeliverApprovalArgs,
  ) => Promise<WorkflowRuntimeRunResult>
  sweep: (
    args?: WorkflowRuntimeSweepArgs,
  ) => Promise<WorkflowRuntimeSweepResult>
}

export interface WorkflowRuntimeStartRunArgs {
  workflowId: WorkflowId
  runId: RunId
  input: unknown
  now?: number
  leaseOwner?: LeaseOwner
  leaseMs?: number
  threadId?: string
  includeEvents?: boolean
  maxEvents?: number
}

export interface WorkflowRuntimeDeliverSignalArgs<TPayload = unknown> {
  runId: RunId
  signalId: string
  stepId?: string
  name: string
  payload: TPayload
  meta?: Record<string, unknown>
  now?: number
  leaseOwner?: LeaseOwner
  leaseMs?: number
  threadId?: string
  includeEvents?: boolean
  maxEvents?: number
}

export interface WorkflowRuntimeDeliverApprovalArgs {
  runId: RunId
  approval: ApprovalResult
  now?: number
  leaseOwner?: LeaseOwner
  leaseMs?: number
  threadId?: string
  includeEvents?: boolean
  maxEvents?: number
}

export type WorkflowRuntimeRunResultKind =
  | 'completed'
  | 'paused'
  | 'errored'
  | 'running'
  | 'not-found'
  | 'not-claimable'
  | 'not-waiting'
  | 'duplicate'

export interface WorkflowRuntimeRunResult {
  kind: WorkflowRuntimeRunResultKind
  runId: RunId
  workflowId?: WorkflowId
  run?: WorkflowExecution
  events: ReadonlyArray<WorkflowEvent>
  eventCount: number
  eventsTruncated?: boolean
}

export interface WorkflowRuntimeSweepArgs {
  now?: number
  limit?: number
  maxScheduledRuns?: number
  maxTimers?: number
  maxDurationMs?: number
  leaseOwner?: LeaseOwner
  leaseMs?: number
  includeEvents?: boolean
  maxEvents?: number
}

export interface WorkflowRuntimeSweepResult {
  scheduled: ReadonlyArray<WorkflowRuntimeRunResult>
  timers: ReadonlyArray<WorkflowRuntimeRunResult>
  summary: WorkflowRuntimeSweepSummary
  deadlineReached: boolean
  remainingMayExist: boolean
}

export type WorkflowRuntimeRunKindCounts = Partial<
  Record<WorkflowRuntimeRunResultKind, number>
>

export interface WorkflowRuntimeSweepSummary {
  scheduled: WorkflowRuntimeRunKindCounts
  timers: WorkflowRuntimeRunKindCounts
  eventCount: number
  returnedEventCount: number
}
