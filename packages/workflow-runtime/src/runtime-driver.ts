import { createWorkflowTelemetry, runWorkflow } from '@tanstack/workflow-core'
import { createRunStoreAdapter } from './run-store-adapter'
import type {
  AnyWorkflowDefinition,
  WorkflowEvent,
  WorkflowTelemetry,
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
  WorkflowRuntimeEventPublisher,
  WorkflowRuntimeRunResult,
  WorkflowRuntimeRunResultKind,
  WorkflowRuntimeStartRunArgs,
  WorkflowRuntimeSweepArgs,
  WorkflowRuntimeSweepResult,
} from './types'

const DEFAULT_LEASE_MS = 30_000
const DEFAULT_SWEEP_LIMIT = 25
const DEFAULT_MIN_YIELD_REMAINING_MS = 1_000

export function createRuntimeDriver<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(config: WorkflowRuntimeConfig<TWorkflows>) {
  const telemetry = createWorkflowTelemetry(
    config.telemetry,
    '@tanstack/workflow-runtime',
  )

  return {
    startRun(args: WorkflowRuntimeStartRunArgs) {
      return startRun(config, telemetry, args)
    },
    deliverSignal<TPayload = unknown>(
      args: WorkflowRuntimeDeliverSignalArgs<TPayload>,
    ) {
      return deliverSignal(config, telemetry, args)
    },
    deliverApproval(args: WorkflowRuntimeDeliverApprovalArgs) {
      return deliverApproval(config, telemetry, args)
    },
    sweep(args: WorkflowRuntimeSweepArgs = {}) {
      return sweep(config, telemetry, args)
    },
  }
}

async function startRun<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  telemetry: WorkflowTelemetry,
  args: WorkflowRuntimeStartRunArgs,
): Promise<WorkflowRuntimeRunResult> {
  return await telemetry.startActiveSpan(
    'start_run',
    {
      workflowId: args.workflowId,
      runId: args.runId,
      leaseOwner: args.leaseOwner,
    },
    async (span) => {
      const startedAt = Date.now()
      const now = args.now ?? startedAt
      const deadline = resolveRuntimeDeadline(args, startedAt)
      const minYieldRemainingMs = normalizeMinYieldRemainingMs(
        args.minYieldRemainingMs,
      )
      const leaseMs = resolveLeaseMs(config, args.leaseMs)
      const workflow = await loadWorkflow(config, args.workflowId)
      const workflowVersion = workflow.version
      span.setAttribute(
        'tanstack.workflow.workflow_version',
        workflowVersion ?? '',
      )
      const created = await traceStoreOperation(
        telemetry,
        'store.create_run',
        {
          workflowId: args.workflowId,
          workflowVersion,
          runId: args.runId,
        },
        () =>
          config.store.createRun({
            runId: args.runId,
            workflowId: args.workflowId,
            workflowVersion,
            input: args.input,
            now,
          }),
      )

      if (created.kind === 'existing' && created.run.status !== 'queued') {
        const result = resultFromExistingRun(created.run)
        span.setAttribute('tanstack.workflow.result_kind', result.kind)
        return result
      }

      const result = await driveClaimedRun(config, telemetry, {
        workflow,
        workflowId: args.workflowId,
        runId: args.runId,
        input: args.input,
        now,
        leaseOwner: args.leaseOwner,
        leaseMs,
        threadId: args.threadId,
        includeEvents: args.includeEvents,
        maxEvents: args.maxEvents,
        deadline,
        minYieldRemainingMs,
        yieldResumeAt: now + 1,
        publish: args.publish,
      })
      span.setAttribute('tanstack.workflow.result_kind', result.kind)
      span.setAttribute('tanstack.workflow.event_count', result.eventCount)
      if (result.eventsTruncated !== undefined) {
        span.setAttribute(
          'tanstack.workflow.events_truncated',
          result.eventsTruncated,
        )
      }
      return result
    },
  )
}

async function startRunFromSweep<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  telemetry: WorkflowTelemetry,
  args: WorkflowRuntimeStartRunArgs & { yieldResumeAt?: number },
): Promise<WorkflowRuntimeRunResult> {
  const startedAt = Date.now()
  const now = args.now ?? startedAt
  const deadline = resolveRuntimeDeadline(args, startedAt)
  const minYieldRemainingMs = normalizeMinYieldRemainingMs(
    args.minYieldRemainingMs,
  )
  const leaseMs = resolveLeaseMs(config, args.leaseMs)
  const workflow = await loadWorkflow(config, args.workflowId)
  const workflowVersion = workflow.version
  const created = await traceStoreOperation(
    telemetry,
    'store.create_run',
    {
      workflowId: args.workflowId,
      workflowVersion,
      runId: args.runId,
    },
    () =>
      config.store.createRun({
        runId: args.runId,
        workflowId: args.workflowId,
        workflowVersion,
        input: args.input,
        now,
      }),
  )

  if (created.kind === 'existing' && created.run.status !== 'queued') {
    return resultFromRunSnapshot(created.run)
  }

  return driveClaimedRun(config, telemetry, {
    workflow,
    workflowId: args.workflowId,
    runId: args.runId,
    input: args.input,
    now,
    leaseOwner: args.leaseOwner,
    leaseMs,
    threadId: args.threadId,
    includeEvents: args.includeEvents,
    maxEvents: args.maxEvents,
    deadline,
    minYieldRemainingMs,
    yieldResumeAt: now + 1,
    publish: args.publish,
  })
}

async function deliverSignal<
  TWorkflows extends Record<string, WorkflowRegistration>,
  TPayload,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  telemetry: WorkflowTelemetry,
  args: WorkflowRuntimeDeliverSignalArgs<TPayload>,
): Promise<WorkflowRuntimeRunResult> {
  return await telemetry.startActiveSpan(
    'deliver_signal',
    {
      runId: args.runId,
      signalName: args.name,
      leaseOwner: args.leaseOwner,
    },
    async (span) => {
      const startedAt = Date.now()
      const now = args.now ?? startedAt
      const deadline = resolveRuntimeDeadline(args, startedAt)
      const minYieldRemainingMs = normalizeMinYieldRemainingMs(
        args.minYieldRemainingMs,
      )
      const leaseMs = resolveLeaseMs(config, args.leaseMs)
      const delivery = {
        signalId: args.signalId,
        stepId: args.stepId,
        name: args.name,
        payload: args.payload,
        meta: args.meta,
      }
      const delivered = await traceStoreOperation(
        telemetry,
        'store.deliver_signal',
        { runId: args.runId, signalName: args.name },
        () =>
          config.store.deliverSignal({
            runId: args.runId,
            delivery,
            now,
          }),
      )
      if (delivered.kind !== 'delivered') {
        const result = resultFromSignalDelivery(args.runId, delivered)
        span.setAttribute('tanstack.workflow.result_kind', result.kind)
        return result
      }

      const workflow = await loadWorkflow(config, delivered.run.workflowId)
      const result = await driveClaimedRun(config, telemetry, {
        workflow,
        workflowId: delivered.run.workflowId,
        runId: args.runId,
        signalDelivery: delivery,
        now,
        leaseOwner: args.leaseOwner,
        leaseMs,
        threadId: args.threadId,
        includeEvents: args.includeEvents,
        maxEvents: args.maxEvents,
        deadline,
        minYieldRemainingMs,
        yieldResumeAt: now + 1,
        publish: args.publish,
      })
      span.setAttribute(
        'tanstack.workflow.workflow_id',
        result.workflowId ?? '',
      )
      span.setAttribute('tanstack.workflow.result_kind', result.kind)
      span.setAttribute('tanstack.workflow.event_count', result.eventCount)
      return result
    },
  )
}

async function deliverSignalFromRuntime<
  TWorkflows extends Record<string, WorkflowRegistration>,
  TPayload,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  telemetry: WorkflowTelemetry,
  args: WorkflowRuntimeDeliverSignalArgs<TPayload> & { yieldResumeAt?: number },
): Promise<WorkflowRuntimeRunResult> {
  const startedAt = Date.now()
  const now = args.now ?? startedAt
  const deadline = resolveRuntimeDeadline(args, startedAt)
  const minYieldRemainingMs = normalizeMinYieldRemainingMs(
    args.minYieldRemainingMs,
  )
  const leaseMs = resolveLeaseMs(config, args.leaseMs)
  const delivery = {
    signalId: args.signalId,
    stepId: args.stepId,
    name: args.name,
    payload: args.payload,
    meta: args.meta,
  }
  const delivered = await traceStoreOperation(
    telemetry,
    'store.deliver_signal',
    { runId: args.runId, signalName: args.name },
    () =>
      config.store.deliverSignal({
        runId: args.runId,
        delivery,
        now,
      }),
  )
  if (delivered.kind !== 'delivered') {
    return resultFromSignalDelivery(args.runId, delivered)
  }

  const workflow = await loadWorkflow(config, delivered.run.workflowId)
  return driveClaimedRun(config, telemetry, {
    workflow,
    workflowId: delivered.run.workflowId,
    runId: args.runId,
    signalDelivery: delivery,
    now,
    leaseOwner: args.leaseOwner,
    leaseMs,
    threadId: args.threadId,
    includeEvents: args.includeEvents,
    maxEvents: args.maxEvents,
    deadline,
    minYieldRemainingMs,
    yieldResumeAt: now + 1,
    publish: args.publish,
  })
}

async function deliverApproval<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  telemetry: WorkflowTelemetry,
  args: WorkflowRuntimeDeliverApprovalArgs,
): Promise<WorkflowRuntimeRunResult> {
  return await telemetry.startActiveSpan(
    'deliver_approval',
    { runId: args.runId, leaseOwner: args.leaseOwner },
    async (span) => {
      const startedAt = Date.now()
      const now = args.now ?? startedAt
      const deadline = resolveRuntimeDeadline(args, startedAt)
      const minYieldRemainingMs = normalizeMinYieldRemainingMs(
        args.minYieldRemainingMs,
      )
      const leaseMs = resolveLeaseMs(config, args.leaseMs)
      const delivered = await traceStoreOperation(
        telemetry,
        'store.deliver_approval',
        { runId: args.runId },
        () =>
          config.store.deliverApproval({
            runId: args.runId,
            approval: args.approval,
            now,
          }),
      )
      if (delivered.kind !== 'delivered') {
        const result = resultFromApprovalDelivery(args.runId, delivered)
        span.setAttribute('tanstack.workflow.result_kind', result.kind)
        return result
      }

      const workflow = await loadWorkflow(config, delivered.run.workflowId)
      const result = await driveClaimedRun(config, telemetry, {
        workflow,
        workflowId: delivered.run.workflowId,
        runId: args.runId,
        approval: args.approval,
        now,
        leaseOwner: args.leaseOwner,
        leaseMs,
        threadId: args.threadId,
        includeEvents: args.includeEvents,
        maxEvents: args.maxEvents,
        deadline,
        minYieldRemainingMs,
        yieldResumeAt: now + 1,
        publish: args.publish,
      })
      span.setAttribute(
        'tanstack.workflow.workflow_id',
        result.workflowId ?? '',
      )
      span.setAttribute('tanstack.workflow.result_kind', result.kind)
      span.setAttribute('tanstack.workflow.event_count', result.eventCount)
      return result
    },
  )
}

async function sweep<TWorkflows extends Record<string, WorkflowRegistration>>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  telemetry: WorkflowTelemetry,
  args: WorkflowRuntimeSweepArgs,
): Promise<WorkflowRuntimeSweepResult> {
  return await telemetry.startActiveSpan(
    'sweep',
    { leaseOwner: args.leaseOwner },
    async (span) => {
      const startedAt = Date.now()
      const now = args.now ?? startedAt
      const deadline = resolveRuntimeDeadline(args, startedAt)
      const minYieldRemainingMs = normalizeMinYieldRemainingMs(
        args.minYieldRemainingMs,
      )
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
      const maxRecoveredRuns = normalizeSweepLimit(
        args.maxRecoveredRuns ?? args.limit,
        DEFAULT_SWEEP_LIMIT,
        'maxRecoveredRuns',
      )
      const leaseOwner = args.leaseOwner ?? createLeaseOwner(`sweep:${now}`)
      span.setAttribute('tanstack.workflow.lease_owner', leaseOwner)
      const leaseMs = resolveLeaseMs(config, args.leaseMs)
      const recovered: Array<WorkflowRuntimeRunResult> = []
      const scheduled: Array<WorkflowRuntimeRunResult> = []
      const timers: Array<WorkflowRuntimeRunResult> = []
      let deadlineReached = false

      while (recovered.length < maxRecoveredRuns) {
        if (shouldStopForDeadline(deadline, minYieldRemainingMs)) {
          deadlineReached = true
          break
        }

        const claims = await traceStoreOperation(
          telemetry,
          'store.claim_stale_runs',
          { leaseOwner },
          () =>
            config.store.claimStaleRuns({
              now,
              limit: 1,
              leaseOwner,
              leaseMs,
            }),
        )
        const claim = claims[0]
        if (!claim) break

        let workflow: AnyWorkflowDefinition
        try {
          workflow = await loadWorkflow(config, claim.run.workflowId)
        } catch (error) {
          await traceStoreOperation(
            telemetry,
            'store.release_run_lease',
            {
              workflowId: claim.run.workflowId,
              workflowVersion: claim.run.workflowVersion,
              runId: claim.run.runId,
              leaseOwner,
            },
            () =>
              config.store.releaseRunLease({
                runId: claim.run.runId,
                leaseOwner,
              }),
          )
          throw error
        }
        const runState = await traceStoreOperation(
          telemetry,
          'store.load_run_state',
          {
            workflowId: claim.run.workflowId,
            workflowVersion: claim.run.workflowVersion,
            runId: claim.run.runId,
          },
          () => config.store.loadRunState(claim.run.runId),
        )
        recovered.push(
          await driveClaimedRun(config, telemetry, {
            workflow,
            workflowId: claim.run.workflowId,
            runId: claim.run.runId,
            input: claim.run.input,
            recover: runState !== undefined,
            now,
            leaseOwner,
            leaseMs,
            includeEvents: args.includeEvents,
            maxEvents: args.maxEvents,
            deadline,
            minYieldRemainingMs,
            yieldResumeAt: now + 1,
            publish: args.publish,
          }),
        )
      }

      while (scheduled.length < maxScheduledRuns) {
        if (shouldStopForDeadline(deadline, minYieldRemainingMs)) {
          deadlineReached = true
          break
        }

        const buckets = await traceStoreOperation(
          telemetry,
          'store.claim_due_schedule_buckets',
          { leaseOwner },
          () =>
            config.store.claimDueScheduleBuckets({
              now,
              limit: 1,
              leaseOwner,
              leaseMs,
            }),
        )
        const bucket = buckets[0]
        if (!bucket) break

        const result = await startRunFromSweep(config, telemetry, {
          workflowId: bucket.workflowId,
          runId: bucket.runId,
          input: bucket.input,
          now,
          leaseOwner,
          leaseMs,
          includeEvents: args.includeEvents,
          maxEvents: args.maxEvents,
          deadline,
          minYieldRemainingMs,
          yieldResumeAt: now + 1,
          publish: args.publish,
        })
        if (result.kind !== 'not-claimable' && result.kind !== 'not-found') {
          await traceStoreOperation(
            telemetry,
            'store.mark_schedule_bucket_started',
            {
              scheduleId: bucket.scheduleId,
              bucketId: bucket.bucketId,
              runId: bucket.runId,
            },
            () =>
              config.store.markScheduleBucketStarted({
                scheduleId: bucket.scheduleId,
                bucketId: bucket.bucketId,
                runId: bucket.runId,
                now,
              }),
          )
        }
        scheduled.push(result)
      }

      while (timers.length < maxTimers) {
        if (shouldStopForDeadline(deadline, minYieldRemainingMs)) {
          deadlineReached = true
          break
        }

        const dueTimers = await traceStoreOperation(
          telemetry,
          'store.claim_due_timers',
          { leaseOwner },
          () =>
            config.store.claimDueTimers({
              now,
              limit: 1,
              leaseOwner,
              leaseMs,
            }),
        )
        const timer = dueTimers[0]
        if (!timer) break

        timers.push(
          await deliverTimer(config, telemetry, {
            timer,
            now,
            leaseOwner,
            leaseMs,
            includeEvents: args.includeEvents,
            maxEvents: args.maxEvents,
            deadline,
            minYieldRemainingMs,
            yieldResumeAt: now + 1,
            publish: args.publish,
          }),
        )
      }

      const result = {
        recovered,
        scheduled,
        timers,
        summary: summarizeSweep(recovered, scheduled, timers),
        deadlineReached,
        remainingMayExist:
          deadlineReached ||
          recovered.length >= maxRecoveredRuns ||
          scheduled.length >= maxScheduledRuns ||
          timers.length >= maxTimers,
      }
      span.setAttribute(
        'tanstack.workflow.event_count',
        result.summary.eventCount,
      )
      return result
    },
  )
}

async function deliverTimer<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  telemetry: WorkflowTelemetry,
  args: {
    timer: TimerWakeup
    now: number
    leaseOwner: string
    leaseMs: number
    includeEvents?: boolean
    maxEvents?: number
    deadline?: number
    minYieldRemainingMs?: number
    yieldResumeAt?: number
    publish?: WorkflowRuntimeEventPublisher
  },
) {
  return deliverSignalFromRuntime(config, telemetry, {
    runId: args.timer.runId,
    signalId: args.timer.signalId,
    name: '__timer',
    payload: undefined,
    now: args.now,
    leaseOwner: args.leaseOwner,
    leaseMs: args.leaseMs,
    includeEvents: args.includeEvents,
    maxEvents: args.maxEvents,
    deadline: args.deadline,
    minYieldRemainingMs: args.minYieldRemainingMs,
    yieldResumeAt: args.yieldResumeAt,
    publish: args.publish,
  })
}

async function driveClaimedRun<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  telemetry: WorkflowTelemetry,
  args: {
    workflow: AnyWorkflowDefinition
    workflowId: string
    runId: string
    input?: unknown
    signalDelivery?: Parameters<typeof runWorkflow>[0]['signalDelivery']
    approval?: Parameters<typeof runWorkflow>[0]['approval']
    recover?: boolean
    now: number
    leaseOwner?: string
    leaseMs?: number
    threadId?: string
    includeEvents?: boolean
    maxEvents?: number
    deadline?: number
    minYieldRemainingMs?: number
    yieldResumeAt?: number
    publish?: WorkflowRuntimeEventPublisher
  },
): Promise<WorkflowRuntimeRunResult> {
  return await telemetry.startActiveSpan(
    'drive_run',
    {
      workflowId: args.workflowId,
      workflowVersion: args.workflow.version,
      runId: args.runId,
      leaseOwner: args.leaseOwner,
    },
    async (span) => {
      const leaseOwner =
        args.leaseOwner ?? createLeaseOwner(`runtime:${args.runId}`)
      const leaseMs = resolveLeaseMs(config, args.leaseMs)
      span.setAttribute('tanstack.workflow.lease_owner', leaseOwner)
      const claim = await traceStoreOperation(
        telemetry,
        'store.claim_run',
        {
          workflowId: args.workflowId,
          workflowVersion: args.workflow.version,
          runId: args.runId,
          leaseOwner,
        },
        () =>
          config.store.claimRun({
            runId: args.runId,
            leaseOwner,
            leaseMs,
            now: Date.now(),
          }),
      )

      if (claim.kind === 'not-found') {
        span.setAttribute('tanstack.workflow.result_kind', 'not-found')
        return {
          kind: 'not-found',
          runId: args.runId,
          workflowId: args.workflowId,
          eventCount: 0,
          events: [],
        }
      }
      if (claim.kind === 'not-claimable') {
        span.setAttribute('tanstack.workflow.result_kind', 'not-claimable')
        return {
          kind: 'not-claimable',
          runId: args.runId,
          workflowId: args.workflowId,
          run: claim.run,
          eventCount: 0,
          events: [],
        }
      }

      const runStore = createRunStoreAdapter(config.store, telemetry)
      const heartbeat = startLeaseHeartbeat(config, telemetry, {
        workflowId: args.workflowId,
        workflowVersion: args.workflow.version,
        runId: args.runId,
        leaseOwner,
        leaseMs,
      })
      let heartbeatError: unknown
      const collected = await (async () => {
        try {
          const events = await collectWorkflowEvents(
            runWorkflow({
              workflow: args.workflow,
              runStore,
              runId: args.runId,
              input: args.input,
              signalDelivery: args.signalDelivery,
              approval: args.approval,
              recover: args.recover,
              threadId: args.threadId,
              publish: combinePublishers(config.publish, args.publish),
              telemetry: config.telemetry,
              deadline: args.deadline,
              minYieldRemainingMs: args.minYieldRemainingMs,
              yieldResumeAt: args.yieldResumeAt,
            }),
            {
              includeEvents: args.includeEvents ?? true,
              maxEvents: args.maxEvents,
            },
          )

          await syncTimerFromRunState(
            config,
            telemetry,
            args.runId,
            args.workflowId,
            args.now,
          )
          return events
        } finally {
          heartbeatError = await heartbeat.stop()
          await traceStoreOperation(
            telemetry,
            'store.release_run_lease',
            {
              workflowId: args.workflowId,
              workflowVersion: args.workflow.version,
              runId: args.runId,
              leaseOwner,
            },
            () =>
              config.store.releaseRunLease({ runId: args.runId, leaseOwner }),
          )
        }
      })()

      if (heartbeatError) throw heartbeatError

      const run = await traceStoreOperation(
        telemetry,
        'store.load_run',
        {
          workflowId: args.workflowId,
          workflowVersion: args.workflow.version,
          runId: args.runId,
        },
        () => config.store.loadRun(args.runId),
      )
      const result: WorkflowRuntimeRunResult = {
        kind: classifyRun(run, collected.eventCount),
        runId: args.runId,
        workflowId: args.workflowId,
        run,
        events: collected.events,
        eventCount: collected.eventCount,
        eventsTruncated: collected.eventsTruncated || undefined,
      }
      span.setAttribute('tanstack.workflow.result_kind', result.kind)
      span.setAttribute('tanstack.workflow.event_count', result.eventCount)
      if (result.eventsTruncated !== undefined) {
        span.setAttribute(
          'tanstack.workflow.events_truncated',
          result.eventsTruncated,
        )
      }
      return result
    },
  )
}

async function syncTimerFromRunState<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  telemetry: WorkflowTelemetry,
  runId: string,
  workflowId: string,
  now: number,
) {
  const state = await traceStoreOperation(
    telemetry,
    'store.load_run_state',
    { workflowId, runId },
    () => config.store.loadRunState(runId),
  )
  const waitingFor = state?.waitingFor
  const deadline = waitingFor?.deadline
  if (
    !state ||
    waitingFor?.signalName !== '__timer' ||
    deadline === undefined
  ) {
    return
  }

  await traceStoreOperation(
    telemetry,
    'store.schedule_timer',
    { workflowId, workflowVersion: state.workflowVersion, runId },
    () =>
      config.store.scheduleTimer({
        runId,
        workflowId,
        workflowVersion: state.workflowVersion,
        wakeAt: deadline,
        signalId: `timer:${runId}:${waitingFor.stepId}:${deadline}`,
        now,
      }),
  )
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

async function traceStoreOperation<T>(
  telemetry: WorkflowTelemetry,
  operation: string,
  spanContext: {
    workflowId?: string
    workflowVersion?: string
    runId?: string
    signalName?: string
    scheduleId?: string
    bucketId?: string
    leaseOwner?: string
  },
  fn: () => Promise<T>,
) {
  return await telemetry.startActiveSpan(operation, spanContext, fn)
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

function resultFromExistingRun(
  run: WorkflowExecution,
): WorkflowRuntimeRunResult {
  return {
    kind: 'not-claimable',
    runId: run.runId,
    workflowId: run.workflowId,
    run,
    events: [],
    eventCount: 0,
  }
}

function resultFromRunSnapshot(
  run: WorkflowExecution,
): WorkflowRuntimeRunResult {
  return {
    kind: classifyRun(run, 0),
    runId: run.runId,
    workflowId: run.workflowId,
    run,
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

function normalizeLeaseMs(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      'Workflow runtime leaseMs must be a positive finite number.',
    )
  }
  return value
}

function resolveLeaseMs<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(config: WorkflowRuntimeConfig<TWorkflows>, leaseMs: number | undefined) {
  return normalizeLeaseMs(leaseMs ?? config.defaultLeaseMs ?? DEFAULT_LEASE_MS)
}

function createLeaseOwner(prefix: string) {
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
}

function resolveRuntimeDeadline(
  args: { deadline?: number; maxDurationMs?: number },
  startedAt: number,
) {
  if (args.deadline !== undefined && !Number.isFinite(args.deadline)) {
    throw new Error('Workflow runtime deadline must be a finite timestamp.')
  }
  if (
    args.maxDurationMs !== undefined &&
    (!Number.isFinite(args.maxDurationMs) || args.maxDurationMs < 0)
  ) {
    throw new Error(
      'Workflow runtime maxDurationMs must be a non-negative finite number.',
    )
  }

  const durationDeadline =
    args.maxDurationMs === undefined
      ? undefined
      : startedAt + args.maxDurationMs
  if (args.deadline === undefined) return durationDeadline
  if (durationDeadline === undefined) return args.deadline
  return Math.min(args.deadline, durationDeadline)
}

function normalizeMinYieldRemainingMs(value: number | undefined) {
  const normalized = value ?? DEFAULT_MIN_YIELD_REMAINING_MS
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(
      'Workflow runtime minYieldRemainingMs must be a non-negative finite number.',
    )
  }
  return normalized
}

function shouldStopForDeadline(
  deadline: number | undefined,
  minYieldRemainingMs: number,
) {
  return deadline !== undefined && deadline - Date.now() <= minYieldRemainingMs
}

function summarizeSweep(
  recovered: ReadonlyArray<WorkflowRuntimeRunResult>,
  scheduled: ReadonlyArray<WorkflowRuntimeRunResult>,
  timers: ReadonlyArray<WorkflowRuntimeRunResult>,
): WorkflowRuntimeSweepResult['summary'] {
  return {
    recovered: countRunKinds(recovered),
    scheduled: countRunKinds(scheduled),
    timers: countRunKinds(timers),
    eventCount:
      sumEventCounts(recovered) +
      sumEventCounts(scheduled) +
      sumEventCounts(timers),
    returnedEventCount:
      sumReturnedEventCounts(recovered) +
      sumReturnedEventCounts(scheduled) +
      sumReturnedEventCounts(timers),
  }
}

function startLeaseHeartbeat<
  TWorkflows extends Record<string, WorkflowRegistration>,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
  telemetry: WorkflowTelemetry,
  args: {
    workflowId: string
    workflowVersion?: string
    runId: string
    leaseOwner: string
    leaseMs: number
  },
) {
  const intervalMs = Math.max(1, Math.floor(args.leaseMs / 3))
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let wake: (() => void) | undefined
  let failure: unknown

  const loop = (async () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by stop() outside this async loop
    while (!stopped) {
      await new Promise<void>((resolve) => {
        wake = resolve
        timer = setTimeout(resolve, intervalMs)
        if (typeof timer === 'object' && 'unref' in timer) timer.unref()
      })
      wake = undefined
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- mutated by stop() while this loop is awaiting the timer
      if (stopped) break

      try {
        await traceStoreOperation(
          telemetry,
          'store.heartbeat_run_lease',
          {
            workflowId: args.workflowId,
            workflowVersion: args.workflowVersion,
            runId: args.runId,
            leaseOwner: args.leaseOwner,
          },
          () =>
            config.store.heartbeatRunLease({
              runId: args.runId,
              leaseOwner: args.leaseOwner,
              leaseMs: args.leaseMs,
              now: Date.now(),
            }),
        )
        failure = undefined
      } catch (error) {
        failure = error
      }
    }
  })()

  return {
    async stop() {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      wake?.()
      await loop
      return failure
    },
  }
}

function combinePublishers(
  configured: WorkflowRuntimeEventPublisher | undefined,
  requested: WorkflowRuntimeEventPublisher | undefined,
): WorkflowRuntimeEventPublisher | undefined {
  const publishers = Array.from(
    new Set(
      [configured, requested].filter(
        (value): value is WorkflowRuntimeEventPublisher => value !== undefined,
      ),
    ),
  )
  if (publishers.length === 0) return undefined

  return async (runId, event) => {
    for (const publish of publishers) {
      try {
        await publish(runId, event)
      } catch {
        // Live fan-out is best-effort and must not change durable execution.
      }
    }
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
