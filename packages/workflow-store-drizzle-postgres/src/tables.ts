import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core'

export const workflowSchemaMigrations = pgTable('workflow_schema_migrations', {
  migrationId: text('migration_id').primaryKey(),
  packageName: text('package_name').notNull(),
  packageVersion: text('package_version'),
  appliedAt: bigint('applied_at', { mode: 'number' }).notNull(),
})

export const workflowRuns = pgTable(
  'workflow_runs',
  {
    runId: text('run_id').primaryKey(),
    workflowId: text('workflow_id').notNull(),
    workflowVersion: text('workflow_version'),
    status: text('status').notNull(),
    input: jsonb('input').notNull(),
    output: jsonb('output'),
    error: jsonb('error'),
    awaiting: jsonb('awaiting'),
    waitingFor: jsonb('waiting_for'),
    pendingApproval: jsonb('pending_approval'),
    wakeAt: bigint('wake_at', { mode: 'number' }),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: bigint('lease_expires_at', { mode: 'number' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('workflow_runs_status_idx').on(table.status, table.updatedAt),
    index('workflow_runs_lease_idx').on(table.status, table.leaseExpiresAt),
  ],
)

export const workflowRunStates = pgTable('workflow_run_states', {
  runId: text('run_id').primaryKey(),
  workflowId: text('workflow_id').notNull(),
  workflowVersion: text('workflow_version'),
  status: text('status').notNull(),
  input: jsonb('input').notNull(),
  output: jsonb('output'),
  error: jsonb('error'),
  awaiting: jsonb('awaiting'),
  waitingFor: jsonb('waiting_for'),
  pendingApproval: jsonb('pending_approval'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
})

export const workflowEventLocks = pgTable('workflow_event_locks', {
  runId: text('run_id').primaryKey(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
})

export const workflowEvents = pgTable(
  'workflow_events',
  {
    runId: text('run_id').notNull(),
    eventIndex: integer('event_index').notNull(),
    eventType: text('event_type').notNull(),
    stepId: text('step_id'),
    event: jsonb('event').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.eventIndex] }),
    index('workflow_events_type_idx').on(table.runId, table.eventType),
  ],
)

export const workflowTimers = pgTable(
  'workflow_timers',
  {
    runId: text('run_id').notNull(),
    signalId: text('signal_id').notNull(),
    workflowId: text('workflow_id').notNull(),
    workflowVersion: text('workflow_version'),
    wakeAt: bigint('wake_at', { mode: 'number' }).notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: bigint('lease_expires_at', { mode: 'number' }),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.signalId] }),
    index('workflow_timers_due_idx').on(table.wakeAt, table.leaseExpiresAt),
  ],
)

export const workflowSignalDeliveries = pgTable(
  'workflow_signal_deliveries',
  {
    runId: text('run_id').notNull(),
    signalId: text('signal_id').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.signalId] })],
)

export const workflowSchedules = pgTable(
  'workflow_schedules',
  {
    scheduleId: text('schedule_id').primaryKey(),
    workflowId: text('workflow_id').notNull(),
    workflowVersion: text('workflow_version'),
    schedule: jsonb('schedule').notNull(),
    overlapPolicy: text('overlap_policy').notNull(),
    input: jsonb('input'),
    nextFireAt: bigint('next_fire_at', { mode: 'number' }),
    enabled: boolean('enabled').notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('workflow_schedules_due_idx').on(table.enabled, table.nextFireAt),
  ],
)

export const workflowScheduleBuckets = pgTable(
  'workflow_schedule_buckets',
  {
    scheduleId: text('schedule_id').notNull(),
    bucketId: text('bucket_id').notNull(),
    workflowId: text('workflow_id').notNull(),
    workflowVersion: text('workflow_version'),
    runId: text('run_id').notNull(),
    fireAt: bigint('fire_at', { mode: 'number' }).notNull(),
    input: jsonb('input'),
    overlapPolicy: text('overlap_policy').notNull(),
    status: text('status').notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: bigint('lease_expires_at', { mode: 'number' }),
    startedAt: bigint('started_at', { mode: 'number' }),
  },
  (table) => [
    primaryKey({ columns: [table.scheduleId, table.bucketId] }),
    index('workflow_schedule_buckets_lease_idx').on(
      table.status,
      table.fireAt,
      table.leaseExpiresAt,
    ),
  ],
)
