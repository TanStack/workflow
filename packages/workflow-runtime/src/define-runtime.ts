import { createRuntimeDriver } from './runtime-driver'
import type {
  WorkflowRegistrationMap,
  WorkflowRuntimeConfig,
  WorkflowRuntimeDefinition,
  WorkflowScheduleSpec,
} from './types'

export function defineWorkflowRuntime<
  const TWorkflows extends WorkflowRegistrationMap,
>(
  config: WorkflowRuntimeConfig<TWorkflows>,
): WorkflowRuntimeDefinition<TWorkflows> {
  const driver = createRuntimeDriver(config)
  return {
    __kind: 'workflow-runtime',
    ...config,
    ...driver,
  }
}

export function cron(
  expression: string,
  options: { timezone?: string } = {},
): WorkflowScheduleSpec {
  return {
    kind: 'cron',
    expression,
    timezone: options.timezone,
  }
}

export const every = {
  milliseconds(everyMs: number): WorkflowScheduleSpec {
    return { kind: 'interval', everyMs }
  },
  seconds(seconds: number): WorkflowScheduleSpec {
    return { kind: 'interval', everyMs: seconds * 1000 }
  },
  minutes(minutes: number): WorkflowScheduleSpec {
    return { kind: 'interval', everyMs: minutes * 60 * 1000 }
  },
  hours(hours: number): WorkflowScheduleSpec {
    return { kind: 'interval', everyMs: hours * 60 * 60 * 1000 }
  },
}
