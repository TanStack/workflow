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

export interface CloudflareWorkflowScheduledController {
  scheduledTime: number
  cron?: string
}

export interface CloudflareWorkflowExecutionContext {
  waitUntil?: (promise: Promise<unknown>) => void
  passThroughOnException?: () => void
}

export interface CloudflareWorkflowScheduledResponse {
  ok: true
  now: number
  leaseOwner: string
  materialized: ReadonlyArray<MaterializedWorkflowSchedule>
  summary: CloudflareWorkflowScheduledSummary
  deadlineReached: boolean
  remainingMayExist: boolean
  sweep?: WorkflowRuntimeSweepResult
}

export type CloudflareWorkflowScheduledSummary =
  WorkflowRuntimeSweepResult['summary'] & {
    materialized: number
  }

export type CloudflareWorkflowScheduledHandler<TEnv = unknown> = (
  controller: CloudflareWorkflowScheduledController,
  env: TEnv,
  ctx: CloudflareWorkflowExecutionContext,
) => Promise<CloudflareWorkflowScheduledResponse>

export interface CloudflareWorkflowScheduledHandlerOptions<
  TWorkflows extends WorkflowRegistrationMap = WorkflowRegistrationMap,
  TEnv = unknown,
> {
  runtime:
    | WorkflowRuntimeDefinition<TWorkflows>
    | ((args: {
        controller: CloudflareWorkflowScheduledController
        env: TEnv
        ctx: CloudflareWorkflowExecutionContext
      }) =>
        | WorkflowRuntimeDefinition<TWorkflows>
        | Promise<WorkflowRuntimeDefinition<TWorkflows>>)
  now?: (controller: CloudflareWorkflowScheduledController) => number
  leaseOwner?:
    | string
    | ((args: {
        controller: CloudflareWorkflowScheduledController
        env: TEnv
        now: number
      }) => string | undefined)
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

export function createCloudflareWorkflowScheduledHandler<
  TWorkflows extends WorkflowRegistrationMap,
  TEnv = unknown,
>(
  options: CloudflareWorkflowScheduledHandlerOptions<TWorkflows, TEnv>,
): CloudflareWorkflowScheduledHandler<TEnv> {
  return async (controller, env, ctx) => {
    const runtime = await resolveRuntime(options.runtime, controller, env, ctx)
    const now = options.now?.(controller) ?? controller.scheduledTime
    const materialized =
      options.materializeSchedules === false
        ? []
        : await materializeWorkflowSchedules(runtime, {
            now,
            cronLookbackMs: options.cronLookbackMs,
          })
    const leaseOwner = resolveLeaseOwner(
      options.leaseOwner,
      controller,
      env,
      now,
    )
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
    const sweep = await runtime.sweep(sweepArgs)

    return {
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
  }
}

async function resolveRuntime<TWorkflows extends WorkflowRegistrationMap, TEnv>(
  runtime: CloudflareWorkflowScheduledHandlerOptions<
    TWorkflows,
    TEnv
  >['runtime'],
  controller: CloudflareWorkflowScheduledController,
  env: TEnv,
  ctx: CloudflareWorkflowExecutionContext,
) {
  if (typeof runtime !== 'function') return runtime
  return await runtime({ controller, env, ctx })
}

function resolveLeaseOwner<TEnv>(
  leaseOwner: CloudflareWorkflowScheduledHandlerOptions<
    WorkflowRegistrationMap,
    TEnv
  >['leaseOwner'],
  controller: CloudflareWorkflowScheduledController,
  env: TEnv,
  now: number,
) {
  if (typeof leaseOwner === 'string') return leaseOwner
  if (typeof leaseOwner === 'function') {
    return (
      leaseOwner({ controller, env, now }) ?? defaultLeaseOwner(controller, now)
    )
  }
  return defaultLeaseOwner(controller, now)
}

function defaultLeaseOwner(
  controller: CloudflareWorkflowScheduledController,
  now: number,
) {
  return `cloudflare:${controller.cron ?? 'scheduled'}:${now}`
}
