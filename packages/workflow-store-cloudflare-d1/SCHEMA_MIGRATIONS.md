# Cloudflare D1 Store Schema Migrations

`@tanstack/workflow-store-cloudflare-d1` owns the durable Workflow store schema
for D1. Applications should apply package-owned migrations instead of copying
`workflow_*` tables into application schema files.

## Adding a Migration

1. Add the next numbered SQL file under `migrations/`.
2. Keep SQL compatible with Cloudflare D1 / SQLite.
3. Make SQL idempotent where possible.
4. Insert a row into `workflow_schema_migrations`.
5. Update `src/schema-contract.ts` so fresh installs get the same final schema.
6. Update `src/migrations.ts` so helpers expose migrations in order.
7. Update tests and docs.
8. Add a changeset for `@tanstack/workflow-store-cloudflare-d1`.

## Verification

```bash
pnpm --filter @tanstack/workflow-store-cloudflare-d1 test:lib
pnpm --filter @tanstack/workflow-store-cloudflare-d1 test:types
pnpm --filter @tanstack/workflow-store-cloudflare-d1 test:eslint
pnpm --filter @tanstack/workflow-store-cloudflare-d1 build
pnpm --filter @tanstack/workflow-store-cloudflare-d1 pack --dry-run
```
