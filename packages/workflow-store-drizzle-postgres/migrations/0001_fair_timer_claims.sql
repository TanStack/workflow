alter table "workflow_timers" add column claim_order bigint not null default 0;

insert into "workflow_schema_migrations" (migration_id, package_name, package_version, applied_at)
 values ('0001_fair_timer_claims', '@tanstack/workflow-store-drizzle-postgres', null, cast(extract(epoch from now()) * 1000 as bigint));
