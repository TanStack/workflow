create table if not exists "workflow_schema_migrations" (
  migration_id text primary key,
  package_name text not null,
  package_version text,
  applied_at bigint not null
);

create table if not exists "workflow_runs" (
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
);

alter table "workflow_runs" add column if not exists awaiting jsonb;

create index if not exists "workflow_runs_status_idx"
  on "workflow_runs" (status, updated_at);

create index if not exists "workflow_runs_lease_idx"
  on "workflow_runs" (status, lease_expires_at);

create table if not exists "workflow_run_states" (
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
);

alter table "workflow_run_states" add column if not exists awaiting jsonb;

create table if not exists "workflow_event_locks" (
  run_id text primary key,
  created_at bigint not null
);

create table if not exists "workflow_events" (
  run_id text not null,
  event_index integer not null,
  event_type text not null,
  step_id text,
  event jsonb not null,
  created_at bigint not null,
  primary key (run_id, event_index)
);

create index if not exists "workflow_events_type_idx"
  on "workflow_events" (run_id, event_type);

create table if not exists "workflow_timers" (
  run_id text not null,
  signal_id text not null,
  workflow_id text not null,
  workflow_version text,
  wake_at bigint not null,
  lease_owner text,
  lease_expires_at bigint,
  primary key (run_id, signal_id)
);

create index if not exists "workflow_timers_due_idx"
  on "workflow_timers" (wake_at, lease_expires_at);

create table if not exists "workflow_signal_deliveries" (
  run_id text not null,
  signal_id text not null,
  created_at bigint not null,
  primary key (run_id, signal_id)
);

create table if not exists "workflow_schedules" (
  schedule_id text primary key,
  workflow_id text not null,
  workflow_version text,
  schedule jsonb not null,
  overlap_policy text not null,
  input jsonb,
  next_fire_at bigint,
  enabled boolean not null,
  updated_at bigint not null
);

create index if not exists "workflow_schedules_due_idx"
  on "workflow_schedules" (enabled, next_fire_at);

create table if not exists "workflow_schedule_buckets" (
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
);

create index if not exists "workflow_schedule_buckets_lease_idx"
  on "workflow_schedule_buckets" (status, fire_at, lease_expires_at);

insert into "workflow_schema_migrations" (
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
on conflict (migration_id) do nothing;
