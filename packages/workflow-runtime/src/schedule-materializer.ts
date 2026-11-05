import type {
  ScheduleId,
  WorkflowRegistrationMap,
  WorkflowRuntimeDefinition,
  WorkflowScheduleDefinition,
  WorkflowScheduleSpec,
} from './types'

const DEFAULT_CRON_LOOKBACK_MS = 32 * 24 * 60 * 60 * 1000

export interface MaterializeWorkflowSchedulesOptions {
  now?: number
  cronLookbackMs?: number
}

export type MaterializedWorkflowSchedule =
  | {
      kind: 'materialized'
      workflowId: string
      scheduleId: ScheduleId
      fireAt: number
      schedule: WorkflowScheduleSpec
    }
  | {
      kind: 'disabled'
      workflowId: string
      scheduleId: ScheduleId
      schedule: WorkflowScheduleSpec
    }
  | {
      kind: 'not-due'
      workflowId: string
      scheduleId: ScheduleId
      schedule: WorkflowScheduleSpec
    }

export async function materializeWorkflowSchedules<
  TWorkflows extends WorkflowRegistrationMap,
>(
  runtime: WorkflowRuntimeDefinition<TWorkflows>,
  options: MaterializeWorkflowSchedulesOptions = {},
): Promise<Array<MaterializedWorkflowSchedule>> {
  const now = options.now ?? Date.now()
  const cronLookbackMs = options.cronLookbackMs ?? DEFAULT_CRON_LOOKBACK_MS
  const materialized: Array<MaterializedWorkflowSchedule> = []

  if (!Number.isFinite(cronLookbackMs) || cronLookbackMs < 0) {
    throw new Error('Workflow cron lookback must be a non-negative number.')
  }

  for (const [workflowId, registration] of Object.entries(runtime.workflows)) {
    const schedules = registration.schedules ?? []
    for (let index = 0; index < schedules.length; index++) {
      const definition = schedules[index]!
      const scheduleId = getScheduleId(workflowId, definition, index)

      if (definition.enabled === false) {
        await runtime.store.upsertSchedule({
          scheduleId,
          workflowId,
          workflowVersion: registration.version,
          schedule: definition.schedule,
          overlapPolicy: definition.overlapPolicy ?? 'skip',
          input: undefined,
          nextFireAt: undefined,
          enabled: false,
          now,
        })
        materialized.push({
          kind: 'disabled',
          workflowId,
          scheduleId,
          schedule: definition.schedule,
        })
        continue
      }

      const fireAt = getDueFireAt(definition.schedule, now, cronLookbackMs)
      if (fireAt === undefined) {
        materialized.push({
          kind: 'not-due',
          workflowId,
          scheduleId,
          schedule: definition.schedule,
        })
        continue
      }

      await runtime.store.upsertSchedule({
        scheduleId,
        workflowId,
        workflowVersion: registration.version,
        schedule: definition.schedule,
        overlapPolicy: definition.overlapPolicy ?? 'skip',
        input: await resolveScheduleInput(definition.input),
        nextFireAt: fireAt,
        enabled: true,
        now,
      })
      materialized.push({
        kind: 'materialized',
        workflowId,
        scheduleId,
        fireAt,
        schedule: definition.schedule,
      })
    }
  }

  return materialized
}

function getScheduleId(
  workflowId: string,
  definition: WorkflowScheduleDefinition,
  index: number,
): ScheduleId {
  return definition.id ?? `${workflowId}:${index}`
}

async function resolveScheduleInput(
  input: WorkflowScheduleDefinition['input'],
) {
  return typeof input === 'function' ? await input() : input
}

function getDueFireAt(
  schedule: WorkflowScheduleSpec,
  now: number,
  cronLookbackMs: number,
) {
  if (schedule.kind === 'interval') {
    if (!Number.isFinite(schedule.everyMs) || schedule.everyMs <= 0) {
      throw new Error(
        'Interval workflow schedules must use a positive everyMs.',
      )
    }
    return Math.floor(now / schedule.everyMs) * schedule.everyMs
  }

  return getPreviousCronFireAt(schedule, now, cronLookbackMs)
}

function getPreviousCronFireAt(
  schedule: Extract<WorkflowScheduleSpec, { kind: 'cron' }>,
  now: number,
  lookbackMs: number,
) {
  if (schedule.timezone && schedule.timezone !== 'UTC') {
    throw new Error(
      `Workflow cron schedules are materialized in UTC. Received timezone "${schedule.timezone}".`,
    )
  }

  const cron = parseCronExpression(schedule.expression)
  const start = floorToMinute(now)
  const end = start - lookbackMs

  for (let timestamp = start; timestamp >= end; timestamp -= 60_000) {
    if (matchesCron(cron, new Date(timestamp))) return timestamp
  }

  return undefined
}

interface ParsedCronExpression {
  minute: ParsedCronField
  hour: ParsedCronField
  dayOfMonth: ParsedCronField
  month: ParsedCronField
  dayOfWeek: ParsedCronField
}

interface ParsedCronField {
  wildcard: boolean
  values: ReadonlySet<number>
}

function parseCronExpression(expression: string): ParsedCronExpression {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error(
      `Workflow cron schedules must use five fields. Received "${expression}".`,
    )
  }

  return {
    minute: parseCronField(fields[0]!, 0, 59),
    hour: parseCronField(fields[1]!, 0, 23),
    dayOfMonth: parseCronField(fields[2]!, 1, 31),
    month: parseCronField(fields[3]!, 1, 12),
    dayOfWeek: parseCronField(fields[4]!, 0, 7, normalizeDayOfWeek),
  }
}

function parseCronField(
  field: string,
  min: number,
  max: number,
  normalize: (value: number) => number = (value) => value,
): ParsedCronField {
  const values = new Set<number>()
  const parts = field.split(',')

  for (const part of parts) {
    const [rangePart, stepPart] = part.split('/')
    const step = stepPart === undefined ? 1 : Number(stepPart)
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid cron step "${part}".`)
    }

    const range = parseCronRange(rangePart!, min, max)
    for (let value = range.start; value <= range.end; value += step) {
      values.add(normalize(value))
    }
  }

  return {
    wildcard: field === '*',
    values,
  }
}

function parseCronRange(range: string, min: number, max: number) {
  if (range === '*') return { start: min, end: max }

  const bounds = range.split('-')
  if (bounds.length === 1) {
    const value = parseCronNumber(bounds[0]!, min, max)
    return { start: value, end: value }
  }
  if (bounds.length === 2) {
    const start = parseCronNumber(bounds[0]!, min, max)
    const end = parseCronNumber(bounds[1]!, min, max)
    if (end < start) throw new Error(`Invalid cron range "${range}".`)
    return { start, end }
  }

  throw new Error(`Invalid cron range "${range}".`)
}

function parseCronNumber(value: string, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid cron value "${value}".`)
  }
  return parsed
}

function normalizeDayOfWeek(value: number) {
  return value === 7 ? 0 : value
}

function matchesCron(cron: ParsedCronExpression, date: Date) {
  const dayOfMonthMatches = cron.dayOfMonth.values.has(date.getUTCDate())
  const dayOfWeekMatches = cron.dayOfWeek.values.has(date.getUTCDay())
  const dayMatches =
    !cron.dayOfMonth.wildcard && !cron.dayOfWeek.wildcard
      ? dayOfMonthMatches || dayOfWeekMatches
      : dayOfMonthMatches && dayOfWeekMatches

  return (
    cron.minute.values.has(date.getUTCMinutes()) &&
    cron.hour.values.has(date.getUTCHours()) &&
    dayMatches &&
    cron.month.values.has(date.getUTCMonth() + 1)
  )
}

function floorToMinute(timestamp: number) {
  return Math.floor(timestamp / 60_000) * 60_000
}
