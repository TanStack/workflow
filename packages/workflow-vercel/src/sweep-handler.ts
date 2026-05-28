import { materializeWorkflowSchedules } from '@tanstack/workflow-runtime'
import type {
  MaterializedWorkflowSchedule,
  WorkflowRegistrationMap,
  WorkflowRuntimeDefinition,
  WorkflowRuntimeSweepArgs,
  WorkflowRuntimeSweepResult,
} from '@tanstack/workflow-runtime'

const DEFAULT_SWEEP_INTERVAL_MINUTES = 5
const DEFAULT_SWEEP_PATH = '/api/workflow/sweep'

export { materializeWorkflowSchedules }
export type {
  MaterializedWorkflowSchedule,
  MaterializeWorkflowSchedulesOptions,
} from '@tanstack/workflow-runtime'

export interface VercelWorkflowCron {
  path: string
  schedule: string
}

export interface VercelWorkflowCronConfig {
  $schema: 'https://openapi.vercel.sh/vercel.json'
  crons: ReadonlyArray<VercelWorkflowCron>
}

export interface VercelWorkflowCronConfigOptions {
  path?: string
  schedule?: string
  everyMinutes?: number
}

export interface VercelWorkflowSweepResponse {
  ok: true
  now: number
  leaseOwner: string
  materialized: ReadonlyArray<MaterializedWorkflowSchedule>
  summary: VercelWorkflowSweepSummary
  deadlineReached: boolean
  remainingMayExist: boolean
  sweep?: WorkflowRuntimeSweepResult
}

export interface VercelWorkflowUnauthorizedResponse {
  ok: false
  error: 'Unauthorized'
}

export type VercelWorkflowSweepSummary =
  WorkflowRuntimeSweepResult['summary'] & {
    materialized: number
  }

export type VercelWorkflowSweepHandler = (request: Request) => Promise<Response>

export interface VercelWorkflowSweepHandlerOptions<
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
  cronSecret?: string
}

export const vercelWorkflowCronConfig = createVercelWorkflowCronConfig()

export function createVercelWorkflowCronConfig(
  options: VercelWorkflowCronConfigOptions = {},
): VercelWorkflowCronConfig {
  const path = options.path ?? DEFAULT_SWEEP_PATH
  if (!path.startsWith('/')) {
    throw new Error('Vercel workflow cron path must start with "/".')
  }
  if (options.schedule) {
    return {
      $schema: 'https://openapi.vercel.sh/vercel.json',
      crons: [{ path, schedule: options.schedule }],
    }
  }

  const everyMinutes = options.everyMinutes ?? DEFAULT_SWEEP_INTERVAL_MINUTES
  if (!Number.isInteger(everyMinutes) || everyMinutes <= 0) {
    throw new Error(
      'Vercel workflow sweep interval must be a positive integer.',
    )
  }

  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    crons: [
      {
        path,
        schedule:
          everyMinutes === 1 ? '* * * * *' : `*/${everyMinutes} * * * *`,
      },
    ],
  }
}

export function createVercelWorkflowSweepHandler<
  TWorkflows extends WorkflowRegistrationMap,
>(
  options: VercelWorkflowSweepHandlerOptions<TWorkflows>,
): VercelWorkflowSweepHandler {
  return async (request) => {
    if (!isAuthorized(request, options.cronSecret)) {
      return Response.json(
        {
          ok: false,
          error: 'Unauthorized',
        } satisfies VercelWorkflowUnauthorizedResponse,
        { status: 401 },
      )
    }

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
    const response: VercelWorkflowSweepResponse = {
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

function isAuthorized(request: Request, cronSecret: string | undefined) {
  if (!cronSecret) return true
  return request.headers.get('authorization') === `Bearer ${cronSecret}`
}

function resolveLeaseOwner(
  leaseOwner: VercelWorkflowSweepHandlerOptions['leaseOwner'],
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
  return `vercel:${request.headers.get('x-vercel-id') ?? now}`
}
