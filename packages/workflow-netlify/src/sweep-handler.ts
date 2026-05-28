import { materializeWorkflowSchedules } from '@tanstack/workflow-runtime'
import type {
  MaterializedWorkflowSchedule,
  WorkflowRegistrationMap,
  WorkflowRuntimeDefinition,
  WorkflowRuntimeSweepArgs,
  WorkflowRuntimeSweepResult,
} from '@tanstack/workflow-runtime'

const DEFAULT_SWEEP_INTERVAL_MINUTES = 5

export { materializeWorkflowSchedules }
export type {
  MaterializedWorkflowSchedule,
  MaterializeWorkflowSchedulesOptions,
} from '@tanstack/workflow-runtime'

export interface NetlifyWorkflowSweepConfig {
  schedule: string
}

export interface NetlifyWorkflowSweepConfigOptions {
  schedule?: string
  everyMinutes?: number
}

export interface NetlifyWorkflowSweepResponse {
  ok: true
  now: number
  leaseOwner: string
  materialized: ReadonlyArray<MaterializedWorkflowSchedule>
  summary: NetlifyWorkflowSweepSummary
  deadlineReached: boolean
  remainingMayExist: boolean
  sweep?: WorkflowRuntimeSweepResult
}

export type NetlifyWorkflowSweepSummary =
  WorkflowRuntimeSweepResult['summary'] & {
    materialized: number
  }

export type NetlifyWorkflowSweepHandler = (
  request: Request,
) => Promise<Response>

export interface NetlifyWorkflowSweepHandlerOptions<
  TWorkflows extends WorkflowRegistrationMap = WorkflowRegistrationMap,
> {
  runtime: WorkflowRuntimeDefinition<TWorkflows>
  now?: () => number
  leaseOwner?:
    | string
    | ((args: { request: Request; now: number }) => string | undefined)
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
}

export const netlifyWorkflowSweepConfig = createNetlifyWorkflowSweepConfig()

export function createNetlifyWorkflowSweepConfig(
  options: NetlifyWorkflowSweepConfigOptions = {},
): NetlifyWorkflowSweepConfig {
  if (options.schedule) return { schedule: options.schedule }

  const everyMinutes = options.everyMinutes ?? DEFAULT_SWEEP_INTERVAL_MINUTES
  if (!Number.isInteger(everyMinutes) || everyMinutes <= 0) {
    throw new Error(
      'Netlify workflow sweep interval must be a positive integer.',
    )
  }

  return {
    schedule: everyMinutes === 1 ? '* * * * *' : `*/${everyMinutes} * * * *`,
  }
}

export function createNetlifyWorkflowSweepHandler<
  TWorkflows extends WorkflowRegistrationMap,
>(
  options: NetlifyWorkflowSweepHandlerOptions<TWorkflows>,
): NetlifyWorkflowSweepHandler {
  return async (request) => {
    const now = options.now?.() ?? Date.now()
    const materialized =
      options.materializeSchedules === false
        ? []
        : await materializeWorkflowSchedules(options.runtime, {
            now,
            cronLookbackMs: options.cronLookbackMs,
          })
    const leaseOwner = resolveLeaseOwner(options.leaseOwner, request, now)
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
    const response: NetlifyWorkflowSweepResponse = {
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

    return Response.json(response)
  }
}

function resolveLeaseOwner(
  leaseOwner: NetlifyWorkflowSweepHandlerOptions['leaseOwner'],
  request: Request,
  now: number,
) {
  if (typeof leaseOwner === 'string') return leaseOwner
  if (typeof leaseOwner === 'function') {
    return leaseOwner({ request, now }) ?? defaultLeaseOwner(request, now)
  }
  return defaultLeaseOwner(request, now)
}

function defaultLeaseOwner(request: Request, now: number) {
  return `netlify:${request.headers.get('x-nf-request-id') ?? now}`
}
