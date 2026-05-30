---
id: store-adapters
title: Store Adapters
---

# Store adapters

Store adapters implement `WorkflowExecutionStore` from
`@tanstack/workflow-runtime`.

## `WorkflowExecutionStore`

The runtime store contract includes:

| Capability | Methods |
| --- | --- |
| Run lifecycle | `createRun`, `loadRun`, `loadExecution`, `markRunPaused`, `markRunFinished`, `markRunErrored` |
| Event log | `appendEvents`, `readEvents`, optional `subscribeEvents` |
| Leases | `claimRun`, `heartbeatRunLease`, `releaseRunLease`, `claimStaleRuns` |
| Timers | `scheduleTimer`, `claimDueTimers` |
| Signals | `deliverSignal` |
| Approvals | `deliverApproval` |
| Schedules | `upsertSchedule`, `claimDueScheduleBuckets`, `markScheduleBucketStarted` |
| Query | `listRuns`, `getRunTimeline` |

Adapter authors should run the shared contract tests from
`@tanstack/workflow-runtime`.

## Drizzle/Postgres

Install:

```bash
pnpm add @tanstack/workflow-store-drizzle-postgres drizzle-orm pg
```

Create the store:

```ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { createDrizzlePostgresWorkflowStore } from '@tanstack/workflow-store-drizzle-postgres'

const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }))
const store = createDrizzlePostgresWorkflowStore({ db })
```

Apply the package-owned migration during setup/deploy:

```bash
psql "$DATABASE_URL" -f node_modules/@tanstack/workflow-store-drizzle-postgres/migrations/0000_workflow_store.sql
```

Use it in the runtime:

```ts
const runtime = defineWorkflowRuntime({
  store,
  workflows,
})
```

## `createDrizzlePostgresWorkflowStore`

```ts
const store = createDrizzlePostgresWorkflowStore({
  db,
  schema: 'public',
  tables: {
    runs: 'workflow_runs',
  },
})
```

Options:

| Option | Purpose |
| --- | --- |
| `db` | Drizzle-compatible database object with `execute` and optional `transaction`. |
| `schema` | Optional Postgres schema name. |
| `tables` | Optional table name overrides. |

## Package-owned migrations

The Drizzle/Postgres package owns the durable Workflow schema. Apps should apply
the SQL artifact from the installed package instead of mirroring `workflow_*`
tables in application Drizzle schema files.

```bash
psql "$DATABASE_URL" -f node_modules/@tanstack/workflow-store-drizzle-postgres/migrations/0000_workflow_store.sql
```

Programmatic setup can use the exported migration helpers:

```ts
import {
  getDrizzlePostgresWorkflowStoreMigrationSql,
  getDrizzlePostgresWorkflowStoreMigrations,
} from '@tanstack/workflow-store-drizzle-postgres'
```

Schema changes are versioned with `@tanstack/workflow-store-drizzle-postgres`.
Apply new package migrations when upgrading the adapter. Runtime code assumes the
database schema is compatible with the installed store adapter version.

The initial migration creates `workflow_schema_migrations` and records applied
Workflow store migrations. Future migrations will be appended as new numbered SQL
files in the package. Apply them in order during deploy/setup before running the
new adapter version.

Maintainers changing the Drizzle/Postgres store schema should follow the
package-local `SCHEMA_MIGRATIONS.md` checklist.

## Cloudflare D1

Install:

```bash
pnpm add @tanstack/workflow-store-cloudflare-d1
```

Create the store from a D1 binding:

```ts
import { createCloudflareD1WorkflowStore } from '@tanstack/workflow-store-cloudflare-d1'

const store = createCloudflareD1WorkflowStore({
  db: env.WORKFLOW_DB,
})
```

Apply the package-owned D1 migration during setup/deploy:

```txt
node_modules/@tanstack/workflow-store-cloudflare-d1/migrations/0000_workflow_store.sql
```

Programmatic setup can use the exported migration helpers:

```ts
import {
  getCloudflareD1WorkflowStoreMigrationSql,
  getCloudflareD1WorkflowStoreMigrations,
} from '@tanstack/workflow-store-cloudflare-d1'
```

D1 stores JSON payloads as text and uses SQLite integer timestamps. Its claim
operations use atomic conditional updates and leases rather than Postgres
`FOR UPDATE SKIP LOCKED`.

## `store.ensureSchema`

Creates the required tables and indexes if they do not exist.

```ts
await store.ensureSchema()
```

Use this from tests, local demos, or an explicit admin bootstrap script, not
from every request or sweep. Runtime and host adapters assume the schema exists.
Production deploys should prefer the package-owned SQL migration artifact.

## Default tables

`defaultDrizzlePostgresWorkflowStoreTables` contains:

| Table key | Default table |
| --- | --- |
| `schemaMigrations` | `workflow_schema_migrations` |
| `runs` | `workflow_runs` |
| `runStates` | `workflow_run_states` |
| `eventLocks` | `workflow_event_locks` |
| `events` | `workflow_events` |
| `timers` | `workflow_timers` |
| `signalDeliveries` | `workflow_signal_deliveries` |
| `schedules` | `workflow_schedules` |
| `scheduleBuckets` | `workflow_schedule_buckets` |

## Optional Drizzle table definitions

The package exports Drizzle table definitions for apps that explicitly want
typed read access for dashboards, diagnostics, or admin tooling:

```ts
import {
  workflowEvents,
  workflowRuns,
  workflowSchedules,
  workflowSchemaMigrations,
} from '@tanstack/workflow-store-drizzle-postgres'
```

These exports are optional. Normal runtime use does not require adding Workflow
tables to your app schema.

## In-memory store

For tests and demos:

```ts
import { inMemoryWorkflowExecutionStore } from '@tanstack/workflow-runtime'

const store = inMemoryWorkflowExecutionStore()
```

The in-memory store implements the same runtime contract, but it is not durable.

## Adapter implementation checklist

A production store adapter should satisfy:

- compare-and-swap append semantics for events
- idempotent run creation
- idempotent signal and approval delivery
- atomic claim and lease semantics
- due timer and due schedule indexes
- stale lease recovery
- timeline and list APIs
- migration strategy
- tests against the shared contract suite
