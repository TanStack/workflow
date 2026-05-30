import { runWorkflow } from '@tanstack/workflow-core'
import { createRunStoreAdapter } from './run-store-adapter'
import type {
  AnyWorkflowDefinition,
  WorkflowEvent,
} from '@tanstack/workflow-core'
import type {
  DeliverApprovalResult,
  DeliverSignalResult,
  TimerWakeup,
  WorkflowExecution,
  WorkflowRegistration,
  WorkflowRuntimeConfig,
  WorkflowRuntimeDeliverApprovalArgs,
  WorkflowRuntimeDeliverSignalArgs,
  WorkflowRuntimeRunResult,
  WorkflowRuntimeRunResultKind,
  WorkflowRuntimeStartRunArgs,
  WorkflowRuntimeSweepArgs,
  WorkflowRuntimeSweepResult,
} from './types'

const DEFAULT_LEASE_MS = 30_000
const DEFAULT_SWEEP_LIMIT = 25

export function createRuntimeDriver<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(config: WorkflowRuntimeConfig<TWorkflows>) {
  return {
    startRun(args: WorkflowRuntimeStartRunArgs) {
      return startRun(config, args)
    },
    deliverSignal<TPayload = unknown>(
      args: WorkflowRuntimeDeliverSignalArgs<TPayload>,
    ) {
      return deliverSignal(config, args)
    },
    deliverApproval(args: WorkflowRuntimeDeliverApprovalArgs) {
      return deliverApproval(config, args)
    },
    sweep(args: WorkflowRuntimeSweepArgs = {}) {
      return sweep(config, args)
    },
  }
}

async function startRun<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  args: WorkflowRuntimeStartRunArgs,
): Promise<WorkflowRuntimeRunResult> {
  const now = args.now ?? Date.now()
  const workflow = await loadWorkflow(config, args.workflowId)
  const workflowVersion = workflow.version
  await config.store.createRun({
    runId: args.runId,
    workflowId: args.workflowId,
    workflowVersion,
    input: args.input,
    now,
  })

  return driveClaimedRun(config, {
    workflow,
    workflowId: args.workflowId,
    runId: args.runId,
    input: args.input,
    now,
    leaseOwner: args.leaseOwner,
    leaseMs: args.leaseMs,
    threadId: args.threadId,
    includeEvents: args.includeEvents,
    maxEvents: args.maxEvents,
  })
}

async function deliverSignal<
  TWorkflows extends Record<string, WorkflowRegistration>,
  TPayload,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  args: WorkflowRuntimeDeliverSignalArgs<TPayload>,
): Promise<WorkflowRuntimeRunResult> {
  const now = args.now ?? Date.now()
  const delivery = {
    signalId: args.signalId,
    stepId: args.stepId,
    name: args.name,
    payload: args.payload,
    meta: args.meta,
  }
  const delivered = await config.store.deliverSignal({
    runId: args.runId,
    delivery,
    now,
  })
  if (delivered.kind !== 'delivered') {
    return resultFromSignalDelivery(args.runId, delivered)
  }

  const workflow = await loadWorkflow(config, delivered.run.workflowId)
  return driveClaimedRun(config, {
    workflow,
    workflowId: delivered.run.workflowId,
    runId: args.runId,
    signalDelivery: delivery,
    now,
    leaseOwner: args.leaseOwner,
    leaseMs: args.leaseMs,
    threadId: args.threadId,
    includeEvents: args.includeEvents,
    maxEvents: args.maxEvents,
  })
}

async function deliverApproval<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  args: WorkflowRuntimeDeliverApprovalArgs,
): Promise<WorkflowRuntimeRunResult> {
  const now = args.now ?? Date.now()
  const delivered = await config.store.deliverApproval({
    runId: args.runId,
    approval: args.approval,
    now,
  })
  if (delivered.kind !== 'delivered') {
    return resultFromApprovalDelivery(args.runId, delivered)
  }

  const workflow = await loadWorkflow(config, delivered.run.workflowId)
  return driveClaimedRun(config, {
    workflow,
    workflowId: delivered.run.workflowId,
    runId: args.runId,
    approval: args.approval,
    now,
    leaseOwner: args.leaseOwner,
    leaseMs: args.leaseMs,
    threadId: args.threadId,
    includeEvents: args.includeEvents,
    maxEvents: args.maxEvents,
  })
}

async function sweep<TWorkflows extends Record<string, WorkflowRegistration>>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  args: WorkflowRuntimeSweepArgs,
): Promise<WorkflowRuntimeSweepResult> {
  const now = args.now ?? Date.now()
  const startedAt = Date.now()
  const maxScheduledRuns = normalizeSweepLimit(
    args.maxScheduledRuns ?? args.limit,
    DEFAULT_SWEEP_LIMIT,
    'maxScheduledRuns',
  )
  const maxTimers = normalizeSweepLimit(
    args.maxTimers ?? args.limit,
    DEFAULT_SWEEP_LIMIT,
    'maxTimers',
  )
  const leaseOwner = args.leaseOwner ?? `sweep:${now}`
  const leaseMs = args.leaseMs ?? config.defaultLeaseMs ?? DEFAULT_LEASE_MS
  const scheduled: Array<WorkflowRuntimeRunResult> = []
  const timers: Array<WorkflowRuntimeRunResult> = []
  let deadlineReached = false

  while (scheduled.length < maxScheduledRuns) {
    if (isPastSweepDeadline(startedAt, args.maxDurationMs)) {
      deadlineReached = true
      break
    }

    const buckets = await config.store.claimDueScheduleBuckets({
      now,
      limit: 1,
      leaseOwner,
      leaseMs,
    })
    const bucket = buckets[0]
    if (!bucket) break

    const result = await startRun(config, {
      workflowId: bucket.workflowId,
      runId: bucket.runId,
      input: bucket.input,
      now,
      leaseOwner,
      leaseMs,
      includeEvents: args.includeEvents,
      maxEvents: args.maxEvents,
    })
    if (result.kind !== 'not-claimable' && result.kind !== 'not-found') {
      await config.store.markScheduleBucketStarted({
        scheduleId: bucket.scheduleId,
        bucketId: bucket.bucketId,
        runId: bucket.runId,
        now,
      })
    }
    scheduled.push(result)
  }

  while (timers.length < maxTimers) {
    if (isPastSweepDeadline(startedAt, args.maxDurationMs)) {
      deadlineReached = true
      break
    }

    const dueTimers = await config.store.claimDueTimers({
      now,
      limit: 1,
      leaseOwner,
      leaseMs,
    })
    const timer = dueTimers[0]
    if (!timer) break

    timers.push(
      await deliverTimer(config, {
        timer,
        now,
        leaseOwner,
        leaseMs,
        includeEvents: args.includeEvents,
        maxEvents: args.maxEvents,
      }),
    )
  }

  return {
    scheduled,
    timers,
    summary: summarizeSweep(scheduled, timers),
    deadlineReached,
    remainingMayExist:
      deadlineReached ||
      scheduled.length >= maxScheduledRuns ||
      timers.length >= maxTimers,
  }
}

async function deliverTimer<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  args: {
    timer: TimerWakeup
    now: number
    leaseOwner: string
    leaseMs: number
    includeEvents?: boolean
    maxEvents?: number
  },
) {
  return deliverSignal(config, {
    runId: args.timer.runId,
    signalId: args.timer.signalId,
    name: '__timer',
    payload: undefined,
    now: args.now,
    leaseOwner: args.leaseOwner,
    leaseMs: args.leaseMs,
    includeEvents: args.includeEvents,
    maxEvents: args.maxEvents,
  })
}

async function driveClaimedRun<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  args: {
    workflow: AnyWorkflowDefinition
    workflowId: string
    runId: string
    input?: unknown
    signalDelivery?: Parameters<typeof runWorkflow>[0]['signalDelivery']
    approval?: Parameters<typeof runWorkflow>[0]['approval']
    now: number
    leaseOwner?: string
    leaseMs?: number
    threadId?: string
    includeEvents?: boolean
    maxEvents?: number
  },
): Promise<WorkflowRuntimeRunResult> {
  const leaseOwner = args.leaseOwner ?? `runtime:${args.runId}`
  const leaseMs = args.leaseMs ?? config.defaultLeaseMs ?? DEFAULT_LEASE_MS
  const claim = await config.store.claimRun({
    runId: args.runId,
    leaseOwner,
    leaseMs,
    now: args.now,
  })

  if (claim.kind === 'not-found') {
    return {
      kind: 'not-found',
      runId: args.runId,
      workflowId: args.workflowId,
      eventCount: 0,
      events: [],
    }
  }
  if (claim.kind === 'not-claimable') {
    return {
      kind: 'not-claimable',
      runId: args.runId,
      workflowId: args.workflowId,
      run: claim.run,
      eventCount: 0,
      events: [],
    }
  }

  const runStore = createRunStoreAdapter(config.store)
  const collected = await collectWorkflowEvents(
    runWorkflow({
      workflow: args.workflow,
      runStore,
      runId: args.runId,
      input: args.input,
      signalDelivery: args.signalDelivery,
      approval: args.approval,
      threadId: args.threadId,
    }),
    {
      includeEvents: args.includeEvents ?? true,
      maxEvents: args.maxEvents,
    },
  )

  await syncTimerFromRunState(config, args.runId, args.workflowId, args.now)
  await config.store.releaseRunLease({ runId: args.runId, leaseOwner })

  const run = await config.store.loadRun(args.runId)
  return {
    kind: classifyRun(run, collected.eventCount),
    runId: args.runId,
    workflowId: args.workflowId,
    run,
    events: collected.events,
    eventCount: collected.eventCount,
    eventsTruncated: collected.eventsTruncated || undefined,
  }
}

async function syncTimerFromRunState<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  runId: string,
  workflowId: string,
  now: number,
) {
  const state = await config.store.loadRunState(runId)
  const deadline = state?.waitingFor?.deadline
  if (state?.waitingFor?.signalName !== '__timer' || deadline === undefined) {
    return
  }

  await config.store.scheduleTimer({
    runId,
    workflowId,
    workflowVersion: state.workflowVersion,
    wakeAt: deadline,
    signalId: `timer:${runId}:${deadline}`,
    now,
  })
}

async function loadWorkflow<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  workflowId: string,
): Promise<AnyWorkflowDefinition> {
  const registration = config.workflows[workflowId]
  if (!registration) {
    throw new Error(`Workflow "${workflowId}" is not registered.`)
  }

  const workflow = normalizeWorkflowLoaderResult(await registration.load())
  const previousVersions = []
  for (const loadPrevious of Object.values(
    registration.previousVersions ?? {},
  )) {
    previousVersions.push(normalizeWorkflowLoaderResult(await loadPrevious()))
  }

  if (registration.version || previousVersions.length > 0) {
    return {
      ...workflow,
      version: registration.version ?? workflow.version,
      previousVersions: [
        ...(workflow.previousVersions ?? []),
        ...previousVersions,
      ],
    }
  }

  return workflow
}

function normalizeWorkflowLoaderResult(
  result: Awaited<ReturnType<WorkflowRegistration['load']>>,
): AnyWorkflowDefinition {
  if ('__kind' in result) return result
  if ('default' in result) return result.default
  return result.workflow
}

function resultFromSignalDelivery(
  runId: string,
  result: Exclude<DeliverSignalResult, { kind: 'delivered' }>,
): WorkflowRuntimeRunResult {
  return {
    kind: result.kind,
    runId,
    run: 'run' in result ? result.run : undefined,
    workflowId: 'run' in result ? result.run.workflowId : undefined,
    events: [],
    eventCount: 0,
  }
}

function resultFromApprovalDelivery(
  runId: string,
  result: Exclude<DeliverApprovalResult, { kind: 'delivered' }>,
): WorkflowRuntimeRunResult {
  return {
    kind: result.kind,
    runId,
    run: 'run' in result ? result.run : undefined,
    workflowId: 'run' in result ? result.run.workflowId : undefined,
    events: [],
    eventCount: 0,
  }
}

function classifyRun(
  run: WorkflowExecution | undefined,
  eventCount: number,
): WorkflowRuntimeRunResult['kind'] {
  if (run?.status === 'finished') return 'completed'
  if (run?.status === 'paused') return 'paused'
  if (run?.status === 'errored' || run?.status === 'aborted') return 'errored'
  if (run?.status === 'running' || run?.status === 'queued') return 'running'
  return eventCount > 0 ? 'running' : 'not-found'
}

function normalizeSweepLimit(
  value: number | undefined,
  fallback: number,
  label: string,
) {
  const limit = value ?? fallback
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`Workflow sweep ${label} must be a non-negative integer.`)
  }
  return limit
}

function isPastSweepDeadline(
  startedAt: number,
  maxDurationMs: number | undefined,
) {
  return maxDurationMs !== undefined && Date.now() - startedAt >= maxDurationMs
}

function summarizeSweep(
  scheduled: ReadonlyArray<WorkflowRuntimeRunResult>,
  timers: ReadonlyArray<WorkflowRuntimeRunResult>,
): WorkflowRuntimeSweepResult['summary'] {
  return {
    scheduled: countRunKinds(scheduled),
    timers: countRunKinds(timers),
    eventCount: sumEventCounts(scheduled) + sumEventCounts(timers),
    returnedEventCount:
      sumReturnedEventCounts(scheduled) + sumReturnedEventCounts(timers),
  }
}

function countRunKinds(runs: ReadonlyArray<WorkflowRuntimeRunResult>) {
  const counts: Partial<Record<WorkflowRuntimeRunResultKind, number>> = {}
  for (const run of runs) {
    counts[run.kind] = (counts[run.kind] ?? 0) + 1
  }
  return counts
}

function sumEventCounts(runs: ReadonlyArray<WorkflowRuntimeRunResult>) {
  return runs.reduce((sum, run) => sum + run.eventCount, 0)
}

function sumReturnedEventCounts(runs: ReadonlyArray<WorkflowRuntimeRunResult>) {
  return runs.reduce((sum, run) => sum + run.events.length, 0)
}

async function collectWorkflowEvents(
  iterable: AsyncIterable<WorkflowEvent>,
  options: {
    includeEvents: boolean
    maxEvents?: number
  },
) {
  if (
    options.maxEvents !== undefined &&
    (!Number.isInteger(options.maxEvents) || options.maxEvents < 0)
  ) {
    throw new Error(
      'Workflow event collection maxEvents must be a non-negative integer.',
    )
  }

  const events: Array<WorkflowEvent> = []
  let eventCount = 0
  let eventsTruncated = false

  for await (const event of iterable) {
    eventCount++
    if (!options.includeEvents) continue
    if (options.maxEvents === undefined || events.length < options.maxEvents) {
      events.push(event)
    } else {
      eventsTruncated = true
    }
  }

  return {
    events,
    eventCount,
    eventsTruncated,
  }
}
