alter table "workflow_timers" add column claim_order integer not null default 0;

create index if not exists "workflow_timers_claim_order_idx" on "workflow_timers" (claim_order);

insert into "workflow_schema_migrations" (migration_id, package_name, package_version, applied_at)
 values ('0001_fair_timer_claims', '@tanstack/workflow-store-cloudflare-d1', null, cast(unixepoch('subsec') * 1000 as integer)) on conflict (migration_id) do nothing;
