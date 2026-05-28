/* eslint-disable @typescript-eslint/require-await -- In-memory implementation satisfies async storage contracts synchronously. */
import { LogConflictError } from '@tanstack/workflow-core'
import type {
  DeleteReason,
  RunState,
  WorkflowEvent,
} from '@tanstack/workflow-core'
import type {
  AppendEventsArgs,
  AppendEventsResult,
  ClaimDueScheduleBucketsArgs,
  ClaimDueTimersArgs,
  ClaimRunArgs,
  ClaimRunResult,
  ClaimStaleRunsArgs,
  CreateRunArgs,
  CreateRunResult,
  DeliverApprovalArgs,
  DeliverApprovalResult,
  DeliverSignalArgs,
  DeliverSignalResult,
  HeartbeatRunLeaseArgs,
  LeaseOwner,
  ListRunsArgs,
  LoadedExecution,
  MarkRunErroredArgs,
  MarkRunFinishedArgs,
  MarkRunPausedArgs,
  MarkScheduleBucketStartedArgs,
  ReadEventsArgs,
  ReleaseRunLeaseArgs,
  RunClaim,
  RunId,
  RunSummary,
  RunTimeline,
  SaveRunStateArgs,
  ScheduleBucket,
  ScheduleBucketId,
  ScheduleId,
  ScheduleTimerArgs,
  StoredWorkflowEvent,
  TimerWakeup,
  UpsertScheduleArgs,
  WorkflowExecution,
  WorkflowExecutionStore,
  WorkflowLease,
  WorkflowRunStoreAdapterStore,
} from './types'

interface TimerRecord extends TimerWakeup {
  lease?: WorkflowLease
}

interface ScheduleRecord {
  scheduleId: ScheduleId
  workflowId: string
  workflowVersion?: string
  nextFireAt?: number
  input: unknown
  overlapPolicy: ScheduleBucket['overlapPolicy']
  enabled: boolean
}

interface ScheduleBucketRecord extends ScheduleBucket {
  status: 'claimed' | 'started'
  lease?: WorkflowLease
}

export type InMemoryWorkflowExecutionStore = WorkflowExecutionStore &
  WorkflowRunStoreAdapterStore

export function inMemoryWorkflowExecutionStore(): InMemoryWorkflowExecutionStore {
  const runs = new Map<RunId, WorkflowExecution>()
  const runStates = new Map<RunId, RunState>()
  const logs = new Map<RunId, Array<StoredWorkflowEvent>>()
  const timers = new Map<string, TimerRecord>()
  const signalDeliveries = new Map<string, true>()
  const schedules = new Map<ScheduleId, ScheduleRecord>()
  const scheduleBuckets = new Map<string, ScheduleBucketRecord>()
  const subscribers = new Map<
    RunId,
    Set<(event: WorkflowEvent, index: number) => void>
  >()

  function setRun(run: WorkflowExecution) {
    runs.set(run.runId, cloneRun(run))
  }

  function getRun(runId: RunId) {
    const run = runs.get(runId)
    return run ? cloneRun(run) : undefined
  }

  function updateRun(
    runId: RunId,
    updater: (run: WorkflowExecution) => WorkflowExecution,
  ) {
    const existing = runs.get(runId)
    if (!existing) return undefined
    const next = updater(cloneRun(existing))
    setRun(next)
    return cloneRun(next)
  }

  return {
    async createRun(args: CreateRunArgs): Promise<CreateRunResult> {
      const existing = getRun(args.runId)
      if (existing) return { kind: 'existing', run: existing }

      const run: WorkflowExecution = {
        runId: args.runId,
        workflowId: args.workflowId,
        workflowVersion: args.workflowVersion,
        status: 'queued',
        input: args.input,
        createdAt: args.now,
        updatedAt: args.now,
      }
      setRun(run)
      return { kind: 'created', run: cloneRun(run) }
    },

    async loadRun(runId: RunId) {
      return getRun(runId)
    },

    async loadExecution(runId: RunId): Promise<LoadedExecution | undefined> {
      const run = getRun(runId)
      if (!run) return undefined
      return {
        run,
        events: cloneStoredEvents(logs.get(runId) ?? []),
      }
    },

    async loadRunState(runId: RunId) {
      const state = runStates.get(runId)
      return state ? cloneRunState(state) : undefined
    },

    async saveRunState(args: SaveRunStateArgs) {
      const state = cloneRunState(args.state)
      runStates.set(state.runId, state)
      setRun(executionFromRunState(state, runs.get(state.runId)?.lease))
    },

    async deleteRun(runId: RunId, _reason: DeleteReason) {
      runs.delete(runId)
      runStates.delete(runId)
      logs.delete(runId)
      subscribers.delete(runId)
      for (const [key, timer] of timers.entries()) {
        if (timer.runId === runId) timers.delete(key)
      }
      for (const key of signalDeliveries.keys()) {
        if (key.startsWith(`${runId}:`)) signalDeliveries.delete(key)
      }
    },

    async appendEvents(args: AppendEventsArgs): Promise<AppendEventsResult> {
      const log = logs.get(args.runId) ?? []
      if (log.length !== args.expectedNextIndex) {
        throw new LogConflictError(
          args.runId,
          args.expectedNextIndex,
          log[args.expectedNextIndex]?.event,
        )
      }

      for (const event of args.events) {
        const stored = storeEvent(args.runId, log.length, event)
        log.push(stored)
        publish(subscribers, args.runId, stored.event, stored.eventIndex)
      }

      logs.set(args.runId, log)
      return { nextIndex: log.length }
    },

    async readEvents(args: ReadEventsArgs) {
      const fromIndex = args.fromIndex ?? 0
      return cloneStoredEvents((logs.get(args.runId) ?? []).slice(fromIndex))
    },

    subscribeEvents(runId, fromIndex, onEvent) {
      const log = logs.get(runId) ?? []
      for (let index = fromIndex; index < log.length; index++) {
        const stored = log[index]
        if (stored) onEvent(stored.event, stored.eventIndex)
      }

      let runSubscribers = subscribers.get(runId)
      if (!runSubscribers) {
        runSubscribers = new Set()
        subscribers.set(runId, runSubscribers)
      }
      runSubscribers.add(onEvent)

      return () => {
        runSubscribers.delete(onEvent)
        if (runSubscribers.size === 0) subscribers.delete(runId)
      }
    },

    async claimRun(args: ClaimRunArgs): Promise<ClaimRunResult> {
      const existing = getRun(args.runId)
      if (!existing) return { kind: 'not-found' }
      if (isTerminal(existing.status)) {
        return { kind: 'not-claimable', run: existing }
      }
      if (!canClaim(existing.lease, args.leaseOwner, args.now)) {
        return { kind: 'not-claimable', run: existing }
      }

      const claimed = updateRun(args.runId, (run) => ({
        ...run,
        status: 'running',
        lease: lease(args.leaseOwner, args.leaseMs, args.now),
        updatedAt: args.now,
      }))
      return { kind: 'claimed', run: claimed! }
    },

    async heartbeatRunLease(args: HeartbeatRunLeaseArgs) {
      updateRun(args.runId, (run) => {
        if (run.lease?.owner !== args.leaseOwner) return run
        return {
          ...run,
          lease: lease(args.leaseOwner, args.leaseMs, args.now),
          updatedAt: args.now,
        }
      })
    },

    async releaseRunLease(args: ReleaseRunLeaseArgs) {
      updateRun(args.runId, (run) => {
        if (run.lease?.owner !== args.leaseOwner) return run
        return {
          ...run,
          lease: undefined,
        }
      })
    },

    async markRunPaused(args: MarkRunPausedArgs) {
      updateRun(args.runId, (run) => ({
        ...run,
        status: 'paused',
        waitingFor: args.waitingFor,
        pendingApproval: args.pendingApproval,
        wakeAt: args.wakeAt,
        lease: undefined,
        updatedAt: args.now,
      }))
    },

    async markRunFinished(args: MarkRunFinishedArgs) {
      updateRun(args.runId, (run) => ({
        ...run,
        status: 'finished',
        output: args.output,
        waitingFor: undefined,
        pendingApproval: undefined,
        wakeAt: undefined,
        lease: undefined,
        updatedAt: args.now,
      }))
    },

    async markRunErrored(args: MarkRunErroredArgs) {
      void args.code
      updateRun(args.runId, (run) => ({
        ...run,
        status: 'errored',
        error: args.error,
        waitingFor: undefined,
        pendingApproval: undefined,
        wakeAt: undefined,
        lease: undefined,
        updatedAt: args.now,
      }))
    },

    async scheduleTimer(args: ScheduleTimerArgs) {
      timers.set(timerKey(args.runId, args.signalId), {
        runId: args.runId,
        workflowId: args.workflowId,
        workflowVersion: args.workflowVersion,
        wakeAt: args.wakeAt,
        signalId: args.signalId,
      })
      updateRun(args.runId, (run) => ({
        ...run,
        wakeAt: args.wakeAt,
        updatedAt: args.now,
      }))
    },

    async claimDueTimers(args: ClaimDueTimersArgs) {
      const due: Array<TimerWakeup> = []
      for (const [key, timer] of timers.entries()) {
        if (due.length >= args.limit) break
        if (timer.wakeAt > args.now) continue
        if (!canClaim(timer.lease, args.leaseOwner, args.now)) continue

        timers.set(key, {
          ...timer,
          lease: lease(args.leaseOwner, args.leaseMs, args.now),
        })
        due.push(cloneTimerWakeup(timer))
      }
      return due
    },

    async deliverSignal<TPayload>(
      args: DeliverSignalArgs<TPayload>,
    ): Promise<DeliverSignalResult> {
      const run = getRun(args.runId)
      if (!run) return { kind: 'not-found' }

      const key = signalKey(args.runId, args.delivery.signalId)
      if (signalDeliveries.has(key)) return { kind: 'duplicate', run }
      if (run.waitingFor?.signalName !== args.delivery.name) {
        return { kind: 'not-waiting', run }
      }

      signalDeliveries.set(key, true)
      timers.delete(timerKey(args.runId, args.delivery.signalId))
      const updated = updateRun(args.runId, (current) => ({
        ...current,
        status: 'queued',
        waitingFor: undefined,
        pendingApproval: undefined,
        wakeAt: undefined,
        updatedAt: args.now,
      }))
      return { kind: 'delivered', run: updated! }
    },

    async deliverApproval(
      args: DeliverApprovalArgs,
    ): Promise<DeliverApprovalResult> {
      const run = getRun(args.runId)
      if (!run) return { kind: 'not-found' }

      const key = signalKey(args.runId, `approval:${args.approval.approvalId}`)
      if (signalDeliveries.has(key)) return { kind: 'duplicate', run }
      if (run.pendingApproval?.approvalId !== args.approval.approvalId) {
        return { kind: 'not-waiting', run }
      }

      signalDeliveries.set(key, true)
      const updated = updateRun(args.runId, (current) => ({
        ...current,
        status: 'queued',
        waitingFor: undefined,
        pendingApproval: undefined,
        wakeAt: undefined,
        updatedAt: args.now,
      }))
      return { kind: 'delivered', run: updated! }
    },

    async upsertSchedule(args: UpsertScheduleArgs) {
      schedules.set(args.scheduleId, {
        scheduleId: args.scheduleId,
        workflowId: args.workflowId,
        workflowVersion: args.workflowVersion,
        nextFireAt: args.nextFireAt,
        input: args.input,
        overlapPolicy: args.overlapPolicy,
        enabled: args.enabled,
      })
    },

    async claimDueScheduleBuckets(args: ClaimDueScheduleBucketsArgs) {
      const due: Array<ScheduleBucket> = []
      for (const schedule of schedules.values()) {
        if (due.length >= args.limit) break
        if (!schedule.enabled || schedule.nextFireAt === undefined) continue
        if (schedule.nextFireAt > args.now) continue

        const bucketId = `${schedule.nextFireAt}` satisfies ScheduleBucketId
        const key = scheduleBucketKey(schedule.scheduleId, bucketId)
        const existing = scheduleBuckets.get(key)
        if (existing?.status === 'started') continue
        if (existing && !canClaim(existing.lease, args.leaseOwner, args.now)) {
          continue
        }

        const bucket: ScheduleBucketRecord = {
          scheduleId: schedule.scheduleId,
          bucketId,
          workflowId: schedule.workflowId,
          workflowVersion: schedule.workflowVersion,
          runId: `${schedule.workflowId}:${schedule.scheduleId}:${bucketId}`,
          fireAt: schedule.nextFireAt,
          input: schedule.input,
          overlapPolicy: schedule.overlapPolicy,
          status: 'claimed',
          lease: lease(args.leaseOwner, args.leaseMs, args.now),
        }
        scheduleBuckets.set(key, bucket)
        due.push(cloneScheduleBucket(bucket))
      }
      return due
    },

    async markScheduleBucketStarted(args: MarkScheduleBucketStartedArgs) {
      const key = scheduleBucketKey(args.scheduleId, args.bucketId)
      const bucket = scheduleBuckets.get(key)
      if (!bucket) return
      scheduleBuckets.set(key, {
        ...bucket,
        runId: args.runId,
        status: 'started',
      })
    },

    async claimStaleRuns(args: ClaimStaleRunsArgs) {
      const claims: Array<RunClaim> = []
      for (const run of runs.values()) {
        if (claims.length >= args.limit) break
        if (run.status !== 'running') continue
        if (!run.lease || run.lease.expiresAt > args.now) continue

        const nextLease = lease(args.leaseOwner, args.leaseMs, args.now)
        const claimed = updateRun(run.runId, (current) => ({
          ...current,
          lease: nextLease,
          updatedAt: args.now,
        }))
        if (claimed) claims.push({ run: claimed, lease: cloneLease(nextLease) })
      }
      return claims
    },

    async listRuns(args: ListRunsArgs) {
      const offset = args.cursor ? Number(args.cursor) : 0
      const start = Number.isFinite(offset) && offset > 0 ? offset : 0
      return Array.from(runs.values())
        .filter((run) => !args.workflowId || run.workflowId === args.workflowId)
        .filter((run) => !args.status || run.status === args.status)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(start, start + args.limit)
        .map(toRunSummary)
    },

    async getRunTimeline(runId: RunId): Promise<RunTimeline | undefined> {
      const run = getRun(runId)
      if (!run) return undefined
      return {
        run,
        events: cloneStoredEvents(logs.get(runId) ?? []),
      }
    },
  }
}

function executionFromRunState(
  state: RunState,
  leaseValue?: WorkflowLease,
): WorkflowExecution {
  return {
    runId: state.runId,
    workflowId: state.workflowId,
    workflowVersion: state.workflowVersion,
    status: state.status,
    input: state.input,
    output: state.output,
    error: state.error,
    waitingFor: state.waitingFor,
    pendingApproval: state.pendingApproval,
    wakeAt:
      state.waitingFor?.signalName === '__timer'
        ? state.waitingFor.deadline
        : undefined,
    lease: leaseValue ? cloneLease(leaseValue) : undefined,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  }
}

function storeEvent(
  runId: RunId,
  eventIndex: number,
  event: WorkflowEvent,
): StoredWorkflowEvent {
  return {
    runId,
    eventIndex,
    eventType: event.type,
    stepId: getStepId(event),
    event,
    createdAt: event.ts,
  }
}

function getStepId(event: WorkflowEvent) {
  return 'stepId' in event ? event.stepId : undefined
}

function lease(owner: LeaseOwner, leaseMs: number, now: number): WorkflowLease {
  return { owner, expiresAt: now + leaseMs }
}

function canClaim(
  existing: WorkflowLease | undefined,
  owner: LeaseOwner,
  now: number,
) {
  return !existing || existing.owner === owner || existing.expiresAt <= now
}

function isTerminal(status: WorkflowExecution['status']) {
  return status === 'finished' || status === 'errored' || status === 'aborted'
}

function timerKey(runId: RunId, signalId: string) {
  return `${runId}:${signalId}`
}

function signalKey(runId: RunId, signalId: string) {
  return `${runId}:${signalId}`
}

function scheduleBucketKey(scheduleId: ScheduleId, bucketId: ScheduleBucketId) {
  return `${scheduleId}:${bucketId}`
}

function publish(
  subscribers: Map<RunId, Set<(event: WorkflowEvent, index: number) => void>>,
  runId: RunId,
  event: WorkflowEvent,
  index: number,
) {
  const runSubscribers = subscribers.get(runId)
  if (!runSubscribers) return
  for (const subscriber of runSubscribers) {
    try {
      subscriber(event, index)
    } catch {
      /* Subscriber errors must not break persistence. */
    }
  }
}

function toRunSummary(run: WorkflowExecution): RunSummary {
  return {
    runId: run.runId,
    workflowId: run.workflowId,
    workflowVersion: run.workflowVersion,
    status: run.status,
    waitingFor: run.waitingFor,
    pendingApproval: run.pendingApproval,
    wakeAt: run.wakeAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  }
}

function cloneRun(run: WorkflowExecution): WorkflowExecution {
  return {
    ...run,
    waitingFor: run.waitingFor
      ? { ...run.waitingFor, meta: cloneRecord(run.waitingFor.meta) }
      : undefined,
    pendingApproval: run.pendingApproval
      ? { ...run.pendingApproval }
      : undefined,
    lease: run.lease ? cloneLease(run.lease) : undefined,
  }
}

function cloneRunState(state: RunState): RunState {
  return {
    ...state,
    waitingFor: state.waitingFor
      ? { ...state.waitingFor, meta: cloneRecord(state.waitingFor.meta) }
      : undefined,
    pendingApproval: state.pendingApproval
      ? { ...state.pendingApproval }
      : undefined,
  }
}

function cloneStoredEvents(
  events: ReadonlyArray<StoredWorkflowEvent>,
): Array<StoredWorkflowEvent> {
  return events.map((event) => ({ ...event }))
}

function cloneTimerWakeup(timer: TimerWakeup): TimerWakeup {
  return { ...timer }
}

function cloneScheduleBucket(bucket: ScheduleBucket): ScheduleBucket {
  return { ...bucket }
}

function cloneLease(leaseValue: WorkflowLease): WorkflowLease {
  return { ...leaseValue }
}

function cloneRecord(value: Record<string, unknown> | undefined) {
  return value ? { ...value } : value
}
