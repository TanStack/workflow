import { materializeWorkflowSchedules } from '@tanstack/workflow-runtime'
import type {
  MaterializedWorkflowSchedule,
  WorkflowRegistrationMap,
  WorkflowRuntimeDefinition,
  WorkflowRuntimeSweepArgs,
  WorkflowRuntimeSweepResult,
} from '@tanstack/workflow-runtime'

export { materializeWorkflowSchedules }
export type {
  MaterializedWorkflowSchedule,
  MaterializeWorkflowSchedulesOptions,
} from '@tanstack/workflow-runtime'

export interface RailwayWorkflowCronResult {
  ok: true
  now: number
  leaseOwner: string
  materialized: ReadonlyArray<MaterializedWorkflowSchedule>
  summary: RailwayWorkflowCronSummary
  deadlineReached: boolean
  remainingMayExist: boolean
  sweep?: WorkflowRuntimeSweepResult
}

export type RailwayWorkflowCronSummary =
  WorkflowRuntimeSweepResult['summary'] & {
    materialized: number
  }

export type RailwayWorkflowCronCommand =
  () => Promise<RailwayWorkflowCronResult>

export interface RailwayWorkflowCronCommandOptions<
  TWorkflows extends WorkflowRegistrationMap = WorkflowRegistrationMap,
> {
  runtime: WorkflowRuntimeDefinition<TWorkflows>
  now?: () => number
  leaseOwner?: string | ((args: { now: number }) => string | undefined)
  limit?: number
  maxScheduledRuns?: number
  maxTimers?: number
  maxDurationMs?: number
  leaseMs?: number
  includeEvents?: boolean
  maxEvents?: number
  includeSweepResult?: boolean
  materializeSchedules?: boolean
  cronLookbackMs?: number
  logSummary?: boolean | ((result: RailwayWorkflowCronResult) => void)
}

export function createRailwayWorkflowCronCommand<
  TWorkflows extends WorkflowRegistrationMap,
>(
  options: RailwayWorkflowCronCommandOptions<TWorkflows>,
): RailwayWorkflowCronCommand {
  return async () => {
    const now = options.now?.() ?? Date.now()
    const materialized =
      options.materializeSchedules === false
        ? []
        : await materializeWorkflowSchedules(options.runtime, {
            now,
            cronLookbackMs: options.cronLookbackMs,
          })
    const leaseOwner = resolveLeaseOwner(options.leaseOwner, now)
    const sweepArgs: WorkflowRuntimeSweepArgs = {
      now,
      leaseOwner,
      limit: options.limit,
      maxScheduledRuns: options.maxScheduledRuns,
      maxTimers: options.maxTimers,
      maxDurationMs: options.maxDurationMs,
      leaseMs: options.leaseMs,
      includeEvents: options.includeEvents ?? false,
      maxEvents: options.maxEvents,
    }
    const sweep = await options.runtime.sweep(sweepArgs)
    const result: RailwayWorkflowCronResult = {
      ok: true,
      now,
      leaseOwner,
      materialized,
      summary: {
        materialized: materialized.length,
        ...sweep.summary,
      },
      deadlineReached: sweep.deadlineReached,
      remainingMayExist: sweep.remainingMayExist,
      ...(options.includeSweepResult ? { sweep } : undefined),
    }

    if (typeof options.logSummary === 'function') {
      options.logSummary(result)
    } else if (options.logSummary) {
      console.log(JSON.stringify(result.summary))
    }

    return result
  }
}

function resolveLeaseOwner(
  leaseOwner: RailwayWorkflowCronCommandOptions['leaseOwner'],
  now: number,
) {
  if (typeof leaseOwner === 'string') return leaseOwner
  if (typeof leaseOwner === 'function') {
    return leaseOwner({ now }) ?? defaultLeaseOwner(now)
  }
  return defaultLeaseOwner(now)
}

function defaultLeaseOwner(now: number) {
  return `railway:${process.env.RAILWAY_SERVICE_ID ?? process.env.RAILWAY_DEPLOYMENT_ID ?? now}`
}
