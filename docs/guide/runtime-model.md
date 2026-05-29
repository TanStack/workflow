---
id: runtime-model
title: Runtime Model
---

# Runtime model

TanStack Workflow has three layers:

1. **Core engine**: deterministic replay and workflow primitives.
2. **Runtime**: execution ownership, schedules, timers, signals, approvals, and
   leases.
3. **Adapters**: stores and host entrypoints for a specific database or
   deployment environment.

That split keeps the core headless while still giving production apps the
operational pieces they need.

## Core engine

`@tanstack/workflow-core` is the small replay engine. It owns:

- `createWorkflow`
- `ctx.step`
- `ctx.waitForEvent`
- `ctx.approve`
- `ctx.sleep` and `ctx.sleepUntil`
- `ctx.now` and `ctx.uuid`
- middleware
- version routing through `version` and `previousVersions`
- the low-level `RunStore` used by `runWorkflow`

The core engine is intentionally not a scheduler, queue, database adapter, or
deployment adapter.

## Runtime

`@tanstack/workflow-runtime` wraps the core engine with a production execution
model:

```ts
const runtime = defineWorkflowRuntime({
  store,
  workflows: {
    fulfillment: {
      load: async () => fulfillmentWorkflow,
      schedules: [
        {
          id: 'fulfillment-every-15m',
          schedule: every.minutes(15),
          overlapPolicy: 'skip',
          input: { batchSize: 100 },
        },
      ],
    },
  },
})
```

The runtime exposes:

- `startRun`
- `deliverSignal`
- `deliverApproval`
- `sweep`

The runtime does not require one process to own a run forever. Each call claims a
run, drives it until it completes or pauses, releases the lease, and returns.

## Execution store

The runtime depends on `WorkflowExecutionStore`. It is richer than the core
`RunStore` because serverless and multi-worker deployments need more than replay:

- idempotent run creation
- append-only event logs
- run state and pause metadata
- timers
- signal and approval deliveries
- schedule definitions and schedule buckets
- atomic claiming and leases
- stale run recovery
- list and timeline APIs

The store is the durability boundary. If a function invocation exits, another
invocation can resume because the store knows the run state, event log, timers,
and pending waits.

## Host adapters

Host adapters are thin. They do not define workflow semantics. They adapt a
deployment provider's entrypoint to `runtime.sweep()`.

Netlify:

```ts
export default createNetlifyWorkflowSweepHandler({
  runtime: workflowRuntime,
  maxDurationMs: 25_000,
})
```

Vercel:

```ts
export const GET = createVercelWorkflowSweepHandler({
  runtime: workflowRuntime,
  cronSecret: process.env.CRON_SECRET,
  maxDurationMs: 55_000,
})
```

Both adapters:

- materialize registered workflow schedules
- call `runtime.sweep`
- default to `includeEvents: false`
- return a compact summary response

## What a sweep does

A sweep is a bounded unit of background work:

```ts
await runtime.sweep({
  maxScheduledRuns: 25,
  maxTimers: 25,
  maxDurationMs: 55_000,
  includeEvents: false,
})
```

The runtime:

1. Claims due schedule buckets.
2. Starts those workflow runs.
3. Claims due timers.
4. Delivers `__timer` signals to sleeping runs.
5. Stops when it reaches count or time budgets.

The response includes:

- `summary`: counts by result kind and event counts
- `deadlineReached`: true if `maxDurationMs` stopped the sweep
- `remainingMayExist`: true if another sweep may be useful

This is the safety valve for serverless hosts. A sweep should be small enough to
fit comfortably inside one host invocation.

## Leases

Leases prevent two workers from executing the same run or due timer at the same
time. They are intentionally time-bounded:

- a worker claims work with `leaseOwner` and `leaseMs`
- another worker cannot claim it until the lease expires
- if the worker crashes, stale lease recovery can claim it later

Leases are not a correctness substitute for idempotency. External side effects
still need idempotency keys, and signal deliveries still need stable `signalId`
values.

## Code loading and versioning

Workflow registrations use async loaders:

```ts
workflows: {
  fulfillment: {
    load: () => import('./fulfillment').then((mod) => mod.fulfillmentWorkflow),
    version: 'v2',
    previousVersions: {
      v1: () => import('./fulfillment.v1').then((mod) => mod.fulfillmentV1),
    },
  },
}
```

This shape helps with:

- code splitting
- lazy loading
- keeping old workflow versions available for paused runs
- loading workflow code outside a closed monorepo TypeScript loop

The store persists stable identifiers like `workflowId`, `workflowVersion`, and
`runId`. It does not persist function closures.

## Memory and event collection

Direct calls like `startRun` and `deliverSignal` return emitted events by
default because they are often used by HTTP handlers or tests.

Sweeps should usually avoid retaining events:

```ts
await runtime.sweep({ includeEvents: false })
```

The runtime still counts all events in `eventCount`; it just does not keep the
full event array in memory. Use `maxEvents` if you want a small sample:

```ts
await runtime.sweep({
  includeEvents: true,
  maxEvents: 100,
})
```

This keeps busy cron sweeps from exploding memory while still making summaries
observable.

## What remains user-owned

TanStack Workflow does not hide infrastructure choices:

- choose the store adapter
- choose cron cadence
- choose queue or webhook ingress
- choose retention policies
- choose dashboards and alerting

The adapters make the default path easier, but the runtime stays headless.
