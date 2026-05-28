---
title: Persistence | TanStack Workflow
---

# Persistence

Durability is the difference between "an async function" and "a workflow." In
TanStack Workflow, durability lives in an explicit store contract.

The store is responsible for the facts that must survive process exits,
deployments, retries, and concurrent workers.

## Two store layers

There are two related store shapes:

| Store | Package | Purpose |
| --- | --- | --- |
| `RunStore` | `@tanstack/workflow-core` | The low-level replay store used directly by `runWorkflow`. |
| `WorkflowExecutionStore` | `@tanstack/workflow-runtime` | The production runtime store for runs, events, timers, schedules, signals, approvals, leases, and timelines. |

Use `RunStore` when embedding the core engine yourself. Use
`WorkflowExecutionStore` when using `defineWorkflowRuntime`.

## What persists

The runtime store persists:

- **Runs**: `runId`, `workflowId`, `workflowVersion`, status, input, output, and
  error.
- **Run state**: the replay metadata needed by the core engine.
- **Events**: the append-only workflow event log.
- **Timers**: due wake-ups for `ctx.sleep` and `ctx.sleepUntil`.
- **Signals**: delivered external events with idempotency.
- **Approvals**: delivered approval decisions with idempotency.
- **Schedules**: registered recurring workflow definitions.
- **Schedule buckets**: due schedule ticks that can be claimed and started.
- **Leases**: ownership records for active work and stale recovery.

The store does not persist JavaScript functions. It persists stable identifiers
and data. Workflow code is loaded by runtime registrations.

## Append-only event log

The event log is the source of truth for replay. Durable primitives append
events such as:

- `STEP_FINISHED`
- `STEP_FAILED`
- `SIGNAL_AWAITED`
- `SIGNAL_RESOLVED`
- `APPROVAL_REQUESTED`
- `APPROVAL_RESOLVED`
- `NOW_RECORDED`
- `UUID_RECORDED`
- `RUN_FINISHED`
- `RUN_ERRORED`

Stores append with `expectedNextIndex`. That compare-and-swap boundary prevents
two writers from committing conflicting event histories for the same run.

## Run state

Run state is the small routing record beside the log. It answers questions like:

- Is the run queued, running, paused, finished, or errored?
- Which workflow version started this run?
- Is the run waiting for a signal?
- Is the run waiting for an approval?
- Is there a timer deadline?

Replay still comes from the event log. Run state makes routing and wake-ups
efficient.

## Timers

`ctx.sleep` and `ctx.sleepUntil` pause the workflow on an internal `__timer`
signal. The runtime persists a timer row with `wakeAt`.

Later, `runtime.sweep()` claims due timers and delivers the internal signal:

```ts
await runtime.sweep({
  maxTimers: 25,
  includeEvents: false,
})
```

The host only wakes the runtime. The store decides which timers are actually
due.

## Schedules

Registered schedules are materialized into schedule buckets:

```ts
workflows: {
  digest: {
    load: async () => digestWorkflow,
    schedules: [
      {
        id: 'digest-every-15m',
        schedule: every.minutes(15),
        overlapPolicy: 'skip',
        input: { batchSize: 100 },
      },
    ],
  },
}
```

`materializeWorkflowSchedules` computes the due fire time and upserts the
schedule record. The sweep then claims due buckets and starts deterministic run
IDs.

This avoids "infinite sleep loop" workflows for recurring jobs. Each scheduled
tick is a fresh run.

## Leases

Leases let many workers safely share one store.

When a worker wants to execute work, it claims the run, timer, or schedule
bucket with:

- `leaseOwner`
- `leaseMs`
- `now`

If the worker finishes, it releases the lease. If it crashes, another worker can
claim stale work after the lease expires.

Use leases to reduce concurrent execution. Use idempotency to protect external
side effects.

## Idempotency

Workflow idempotency has several layers:

- `runId`: starting the same run twice should not create two executions.
- `stepCtx.id`: use this as the idempotency key for external side effects.
- `signalId`: webhook retries should deliver the same signal once.
- `approvalId`: approval retries should deliver the same approval once.
- schedule bucket IDs: the same scheduled tick should start the same run.

Do not rely on cron providers to deliver exactly once. Assume duplicate delivery
is possible.

## Drizzle/Postgres adapter

The Drizzle/Postgres adapter implements `WorkflowExecutionStore`:

```ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { createDrizzlePostgresWorkflowStore } from '@tanstack/workflow-store-drizzle-postgres'

const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }))
const store = createDrizzlePostgresWorkflowStore({
  db,
  schema: 'public',
})

await store.ensureSchema()
```

You can override table names:

```ts
const store = createDrizzlePostgresWorkflowStore({
  db,
  tables: {
    runs: 'app_workflow_runs',
    events: 'app_workflow_events',
  },
})
```

The default tables include runs, run states, event locks, events, timers, signal
deliveries, schedules, and schedule buckets.

## Retention

Terminal runs usually remain for some period so:

- attach/read APIs can show final results
- webhook retries can remain idempotent
- debugging has a timeline
- metrics and audits can be extracted

Retention policy belongs to the store or an admin job. A production store should
eventually expose cleanup helpers for terminal runs and old events.

## Production requirements

A production-quality store should provide:

- atomic event append
- atomic claim and lease operations
- due timer indexes
- due schedule bucket indexes
- idempotent signal and approval delivery
- stale lease recovery
- migration-safe schema management
- query APIs for dashboards and support tools

Postgres can do all of this in one portable substrate, which is why it is the
first serious store target.
