# @tanstack/workflow-store-drizzle-postgres

Experimental Drizzle/Postgres durable execution store for TanStack Workflow.

See the main [Persistence guide](../../docs/guide/persistence.md) and
[Store adapters API](../../docs/api/store-adapters.md).

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

await store.ensureSchema()
```
