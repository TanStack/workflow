export interface CloudflareD1WorkflowStoreTables {
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

export interface CloudflareD1WorkflowStoreSchemaOptions {
  tables?: Partial<CloudflareD1WorkflowStoreTables>
}

export const defaultCloudflareD1WorkflowStoreTables: CloudflareD1WorkflowStoreTables =
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

export function resolveCloudflareD1WorkflowStoreTables(
  tables?: Partial<CloudflareD1WorkflowStoreTables>,
): CloudflareD1WorkflowStoreTables {
  return {
    ...defaultCloudflareD1WorkflowStoreTables,
    ...tables,
  }
}

export function getCloudflareD1WorkflowStoreSchemaStatements(
  options: CloudflareD1WorkflowStoreSchemaOptions = {},
): Array<string> {
  const tables = resolveCloudflareD1WorkflowStoreTables(options.tables)
  const schemaMigrations = quoteIdent(tables.schemaMigrations)
  const runs = quoteIdent(tables.runs)
  const runStates = quoteIdent(tables.runStates)
  const eventLocks = quoteIdent(tables.eventLocks)
  const events = quoteIdent(tables.events)
  const timers = quoteIdent(tables.timers)
  const signalDeliveries = quoteIdent(tables.signalDeliveries)
  const schedules = quoteIdent(tables.schedules)
  const scheduleBuckets = quoteIdent(tables.scheduleBuckets)

  return [
    `create table if not exists ${schemaMigrations} (
      migration_id text primary key,
      package_name text not null,
      package_version text,
      applied_at integer not null
    )`,
    `create table if not exists ${runs} (
      run_id text primary key,
      workflow_id text not null,
      workflow_version text,
      status text not null,
      input text not null,
      output text,
      error text,
      awaiting text,
      waiting_for text,
      pending_approval text,
      wake_at integer,
      lease_owner text,
      lease_expires_at integer,
      created_at integer not null,
      updated_at integer not null
    )`,
    `create index if not exists ${quoteIdent(`${tables.runs}_status_idx`)}
      on ${runs} (status, updated_at)`,
    `create index if not exists ${quoteIdent(`${tables.runs}_lease_idx`)}
      on ${runs} (status, lease_expires_at)`,
    `create table if not exists ${runStates} (
      run_id text primary key,
      workflow_id text not null,
      workflow_version text,
      status text not null,
      input text not null,
      output text,
      error text,
      awaiting text,
      waiting_for text,
      pending_approval text,
      created_at integer not null,
      updated_at integer not null
    )`,
    `create table if not exists ${eventLocks} (
      run_id text primary key,
      created_at integer not null
    )`,
    `create table if not exists ${events} (
      run_id text not null,
      event_index integer not null,
      event_type text not null,
      step_id text,
      event text not null,
      created_at integer not null,
      primary key (run_id, event_index)
    )`,
    `create index if not exists ${quoteIdent(`${tables.events}_type_idx`)}
      on ${events} (run_id, event_type)`,
    `create table if not exists ${timers} (
      run_id text not null,
      signal_id text not null,
      workflow_id text not null,
      workflow_version text,
      wake_at integer not null,
      lease_owner text,
      lease_expires_at integer,
      primary key (run_id, signal_id)
    )`,
    `create index if not exists ${quoteIdent(`${tables.timers}_due_idx`)}
      on ${timers} (wake_at, lease_expires_at)`,
    `create table if not exists ${signalDeliveries} (
      run_id text not null,
      signal_id text not null,
      created_at integer not null,
      primary key (run_id, signal_id)
    )`,
    `create table if not exists ${schedules} (
      schedule_id text primary key,
      workflow_id text not null,
      workflow_version text,
      schedule text not null,
      overlap_policy text not null,
      input text,
      next_fire_at integer,
      enabled integer not null,
      updated_at integer not null
    )`,
    `create index if not exists ${quoteIdent(`${tables.schedules}_due_idx`)}
      on ${schedules} (enabled, next_fire_at)`,
    `create table if not exists ${scheduleBuckets} (
      schedule_id text not null,
      bucket_id text not null,
      workflow_id text not null,
      workflow_version text,
      run_id text not null,
      fire_at integer not null,
      input text,
      overlap_policy text not null,
      status text not null,
      lease_owner text,
      lease_expires_at integer,
      started_at integer,
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
      '@tanstack/workflow-store-cloudflare-d1',
      null,
      cast(unixepoch('subsec') * 1000 as integer)
    )
    on conflict (migration_id) do nothing`,
  ].map(normalizeSqlStatement)
}

export function quoteIdent(identifier: string) {
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
