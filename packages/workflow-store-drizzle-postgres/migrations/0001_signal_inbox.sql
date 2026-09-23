create table if not exists "workflow_signal_inbox" (
  sequence bigserial primary key,
  run_id text not null,
  signal_id text not null,
  name text not null,
  step_id text,
  delivery jsonb not null,
  created_at bigint not null,
  unique (run_id, signal_id)
);

create index if not exists "workflow_signal_inbox_pending_idx"
  on "workflow_signal_inbox" (run_id, name, sequence);

create index if not exists "workflow_events_signal_id_idx"
  on "workflow_events" (run_id, (event->>'signalId'))
  where event_type = 'SIGNAL_RESOLVED';

insert into "workflow_schema_migrations" (migration_id, package_name, package_version, applied_at)
  values ('0001_signal_inbox', '@tanstack/workflow-store-drizzle-postgres', null, cast(extract(epoch from clock_timestamp()) * 1000 as bigint))
  on conflict (migration_id) do nothing;
