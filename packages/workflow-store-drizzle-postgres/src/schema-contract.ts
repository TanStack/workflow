export interface DrizzlePostgresWorkflowStoreTables {
  schemaMigrations: string
  runs: string
  runStates: string
  eventLocks: string
  events: string
  timers: string
  signalDeliveries: string
  schedules: string
  scheduleBuckets: string
}

export interface DrizzlePostgresWorkflowStoreSchemaOptions {
  schema?: string
  tables?: Partial<DrizzlePostgresWorkflowStoreTables>
}

export const defaultDrizzlePostgresWorkflowStoreTables: DrizzlePostgresWorkflowStoreTables =
  {
    schemaMigrations: 'workflow_schema_migrations',
    runs: 'workflow_runs',
    runStates: 'workflow_run_states',
    eventLocks: 'workflow_event_locks',
    events: 'workflow_events',
    timers: 'workflow_timers',
    signalDeliveries: 'workflow_signal_deliveries',
    schedules: 'workflow_schedules',
    scheduleBuckets: 'workflow_schedule_buckets',
  }

export function resolveDrizzlePostgresWorkflowStoreTables(
  tables?: Partial<DrizzlePostgresWorkflowStoreTables>,
): DrizzlePostgresWorkflowStoreTables {
  return {
    ...defaultDrizzlePostgresWorkflowStoreTables,
    ...tables,
  }
}

export function getDrizzlePostgresWorkflowStoreSchemaStatements(
  options: DrizzlePostgresWorkflowStoreSchemaOptions = {},
): Array<string> {
  const tables = resolveDrizzlePostgresWorkflowStoreTables(options.tables)
  const schemaMigrations = qualifiedTableName(
    options.schema,
    tables.schemaMigrations,
  )
  const runs = qualifiedTableName(options.schema, tables.runs)
  const runStates = qualifiedTableName(options.schema, tables.runStates)
  const eventLocks = qualifiedTableName(options.schema, tables.eventLocks)
  const events = qualifiedTableName(options.schema, tables.events)
  const timers = qualifiedTableName(options.schema, tables.timers)
  const signalDeliveries = qualifiedTableName(
    options.schema,
    tables.signalDeliveries,
  )
  const schedules = qualifiedTableName(options.schema, tables.schedules)
  const scheduleBuckets = qualifiedTableName(
    options.schema,
    tables.scheduleBuckets,
  )

  return [
    ...(options.schema
      ? [`create schema if not exists ${quoteIdent(options.schema)}`]
      : []),
    `create table if not exists ${schemaMigrations} (
      migration_id text primary key,
      package_name text not null,
      package_version text,
      applied_at bigint not null
    )`,
    `create table if not exists ${runs} (
      run_id text primary key,
      workflow_id text not null,
      workflow_version text,
      status text not null,
      input jsonb not null,
      output jsonb,
      error jsonb,
      awaiting jsonb,
      waiting_for jsonb,
      pending_approval jsonb,
      wake_at bigint,
      lease_owner text,
      lease_expires_at bigint,
      created_at bigint not null,
      updated_at bigint not null
    )`,
    `alter table ${runs} add column if not exists awaiting jsonb`,
    `create index if not exists ${quoteIdent(`${tables.runs}_status_idx`)}
      on ${runs} (status, updated_at)`,
    `create index if not exists ${quoteIdent(`${tables.runs}_lease_idx`)}
      on ${runs} (status, lease_expires_at)`,
    `create table if not exists ${runStates} (
      run_id text primary key,
      workflow_id text not null,
      workflow_version text,
      status text not null,
      input jsonb not null,
      output jsonb,
      error jsonb,
      awaiting jsonb,
      waiting_for jsonb,
      pending_approval jsonb,
      created_at bigint not null,
      updated_at bigint not null
    )`,
    `alter table ${runStates} add column if not exists awaiting jsonb`,
    `create table if not exists ${eventLocks} (
      run_id text primary key,
      created_at bigint not null
    )`,
    `create table if not exists ${events} (
      run_id text not null,
      event_index integer not null,
      event_type text not null,
      step_id text,
      event jsonb not null,
      created_at bigint not null,
      primary key (run_id, event_index)
    )`,
    `create index if not exists ${quoteIdent(`${tables.events}_type_idx`)}
      on ${events} (run_id, event_type)`,
    `create table if not exists ${timers} (
      run_id text not null,
      signal_id text not null,
      workflow_id text not null,
      workflow_version text,
      wake_at bigint not null,
      lease_owner text,
      lease_expires_at bigint,
      primary key (run_id, signal_id)
    )`,
    `create index if not exists ${quoteIdent(`${tables.timers}_due_idx`)}
      on ${timers} (wake_at, lease_expires_at)`,
    `create table if not exists ${signalDeliveries} (
      run_id text not null,
      signal_id text not null,
      created_at bigint not null,
      primary key (run_id, signal_id)
    )`,
    `create table if not exists ${schedules} (
      schedule_id text primary key,
      workflow_id text not null,
      workflow_version text,
      schedule jsonb not null,
      overlap_policy text not null,
      input jsonb,
      next_fire_at bigint,
      enabled boolean not null,
      updated_at bigint not null
    )`,
    `create index if not exists ${quoteIdent(`${tables.schedules}_due_idx`)}
      on ${schedules} (enabled, next_fire_at)`,
    `create table if not exists ${scheduleBuckets} (
      schedule_id text not null,
      bucket_id text not null,
      workflow_id text not null,
      workflow_version text,
      run_id text not null,
      fire_at bigint not null,
      input jsonb,
      overlap_policy text not null,
      status text not null,
      lease_owner text,
      lease_expires_at bigint,
      started_at bigint,
      primary key (schedule_id, bucket_id)
    )`,
    `create index if not exists ${quoteIdent(
      `${tables.scheduleBuckets}_lease_idx`,
    )}
      on ${scheduleBuckets} (status, fire_at, lease_expires_at)`,
    `insert into ${schemaMigrations} (
      migration_id,
      package_name,
      package_version,
      applied_at
    )
    values (
      '0000_workflow_store',
      '@tanstack/workflow-store-drizzle-postgres',
      null,
      (extract(epoch from now()) * 1000)::bigint
    )
    on conflict (migration_id) do nothing`,
  ].map(normalizeSqlStatement)
}

export function qualifiedTableName(schema: string | undefined, table: string) {
  return schema
    ? `${quoteIdent(schema)}.${quoteIdent(table)}`
    : quoteIdent(table)
}

function quoteIdent(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function normalizeSqlStatement(statement: string) {
  return statement
    .split('\n')
    .map((line, index) =>
      index === 0 ? line.trimEnd() : line.replace(/^ {4}/, '').trimEnd(),
    )
    .join('\n')
}
