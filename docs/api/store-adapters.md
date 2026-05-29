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

await store.ensureSchema()
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

## `store.ensureSchema`

Creates the required tables and indexes if they do not exist.

```ts
await store.ensureSchema()
```

Use this from an explicit app-owned bootstrap/admin script, not from every
request or sweep. Runtime and host adapters assume the schema exists. In
production, you may want to run equivalent SQL through your migration system
instead of calling this at application startup.

## Default tables

`defaultDrizzlePostgresWorkflowStoreTables` contains:

| Table key | Default table |
| --- | --- |
| `runs` | `workflow_runs` |
| `runStates` | `workflow_run_states` |
| `eventLocks` | `workflow_event_locks` |
| `events` | `workflow_events` |
| `timers` | `workflow_timers` |
| `signalDeliveries` | `workflow_signal_deliveries` |
| `schedules` | `workflow_schedules` |
| `scheduleBuckets` | `workflow_schedule_buckets` |

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
