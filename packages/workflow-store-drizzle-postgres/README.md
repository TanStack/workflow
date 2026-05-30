# @tanstack/workflow-store-drizzle-postgres

Experimental Drizzle/Postgres durable execution store for TanStack Workflow.

See the main [Persistence guide](../../docs/guide/persistence.md) and
[Store adapters API](../../docs/api/store-adapters.md).
Maintainers changing the durable schema should follow
[SCHEMA_MIGRATIONS.md](./SCHEMA_MIGRATIONS.md).

This adapter implements the `WorkflowExecutionStore` contract from
`@tanstack/workflow-runtime`. Drizzle is only the database execution surface; the
workflow runtime remains backed by the store contract.

## Usage

```bash
pnpm add @tanstack/workflow-store-drizzle-postgres drizzle-orm pg
```

```ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { createDrizzlePostgresWorkflowStore } from '@tanstack/workflow-store-drizzle-postgres'

const db = drizzle(pool)
const store = createDrizzlePostgresWorkflowStore({ db })
```

Apply the package-owned migration during setup/deploy:

```bash
psql "$DATABASE_URL" -f node_modules/@tanstack/workflow-store-drizzle-postgres/migrations/0000_workflow_store.sql
```

`store.ensureSchema()` remains available for tests, local demos, and explicit
admin bootstrap scripts. Production deploys should prefer the published SQL
migration artifact so schema changes are reviewed and repeatable.

The migration creates `workflow_schema_migrations` and records the applied
Workflow store migration ID. Future schema changes will ship as additional
numbered SQL files in this package.
