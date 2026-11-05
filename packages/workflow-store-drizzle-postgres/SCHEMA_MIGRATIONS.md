# Drizzle/Postgres Store Schema Migrations

`@tanstack/workflow-store-drizzle-postgres` owns the durable Workflow store
schema. Applications should apply package-owned migrations instead of copying
`workflow_*` tables into their own Drizzle schema.

## When to Version

Create a changeset for this package whenever a change affects:

- SQL migration files in `migrations/`
- generated migration helpers in `src/migrations.ts`
- store schema statements in `src/schema-contract.ts`
- exported Drizzle table definitions in `src/tables.ts`
- runtime code that expects a different table, column, index, or lock shape

Use a patch changeset for backward-compatible additive schema changes. Use a
minor or major changeset when an upgrade requires coordinated application action
or cannot be safely rolled out with the previous runtime/store version.

## Adding a Migration

1. Add the next numbered SQL file under `migrations/`, for example
   `0001_add_retention_indexes.sql`.
2. Make the SQL idempotent where possible:
   - use `create table if not exists`
   - use `create index if not exists`
   - prefer additive columns/indexes before destructive changes
3. Insert a row into `workflow_schema_migrations` from the migration:

   ```sql
   insert into "workflow_schema_migrations" (
     migration_id,
     package_name,
     package_version,
     applied_at
   )
   values (
     '0001_add_retention_indexes',
     '@tanstack/workflow-store-drizzle-postgres',
     null,
     (extract(epoch from now()) * 1000)::bigint
   )
   on conflict (migration_id) do nothing;
   ```

4. Update `src/schema-contract.ts` so fresh installs get the same final schema.
5. Update `src/migrations.ts` so programmatic migration helpers expose the new
   migration in order.
6. Update optional typed table exports in `src/tables.ts` if table definitions
   changed.
7. Update docs that mention production setup or compatibility.
8. Add or update tests that verify:
   - generated SQL matches the checked-in SQL artifact
   - `ensureSchema()` creates the same final schema for local/test bootstrap
   - the migration is recorded in `workflow_schema_migrations`

## Compatibility Rules

- Runtime and host adapters assume the durable store schema already exists.
- Production deploys should apply package-owned SQL migrations before rolling
  out a store adapter version that expects them.
- `ensureSchema()` is for tests, local demos, and explicit admin/bootstrap
  scripts. Do not call it from request handlers, scheduled sweeps, or cron
  ticks.
- Apps may import the optional Drizzle table definitions for diagnostics/admin
  reads, but normal runtime use should not require app-owned `workflow_*` table
  declarations.

## Verification

Run these checks before handing off schema work:

```bash
pnpm --filter @tanstack/workflow-store-drizzle-postgres test:lib
pnpm --filter @tanstack/workflow-store-drizzle-postgres test:types
pnpm --filter @tanstack/workflow-store-drizzle-postgres test:eslint
pnpm --filter @tanstack/workflow-store-drizzle-postgres build
pnpm --filter @tanstack/workflow-store-drizzle-postgres pack --dry-run
pnpm test:docs
pnpm test:knip
pnpm test:sherif
```

Confirm the dry-run tarball includes every SQL file under `migrations/`.
