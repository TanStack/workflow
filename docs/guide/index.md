---
id: guide
title: Tutorial and Guide
---

# Tutorial and guide

TanStack Workflow is a headless durable execution system for TypeScript. You
write workflows as ordinary async functions, mark durable work with explicit
primitives, and choose where persistence, timers, schedules, and deployment
live.

This guide walks through the production shape:

1. Define a workflow with `@tanstack/workflow-core`.
2. Put it behind a runtime with `@tanstack/workflow-runtime`.
3. Persist executions in a durable store.
4. Wake due timers and schedules with a host cron, scheduled function, or worker.
5. Deploy the same workflow code on Vercel, Netlify, Cloudflare, Node, or your
   own infrastructure.

## Package map

| Package | Purpose |
| --- | --- |
| `@tanstack/workflow-core` | The replay engine, workflow builder, primitives, middleware, version routing, and low-level `RunStore`. |
| `@tanstack/workflow-runtime` | The deployment-independent runtime, execution store contract, schedules, timers, leases, and sweep driver. |
| `@tanstack/workflow-store-drizzle-postgres` | A Postgres implementation of the runtime execution store contract using Drizzle as the SQL surface. |
| `@tanstack/workflow-vercel` | A Vercel route handler and cron config helper that call `runtime.sweep()`. |
| `@tanstack/workflow-netlify` | A Netlify Scheduled Function handler and config helper that call `runtime.sweep()`. |

The important boundary is this:

> Workflow code is portable. Stores and host adapters are replaceable.

The engine is not Drizzle-backed, Vercel-backed, Netlify-backed, or cron-backed.
Those are capability adapters around a common runtime/store contract.

## Install

For local development:

```bash
pnpm add @tanstack/workflow-core @tanstack/workflow-runtime zod
```

For a Postgres-backed deployment:

```bash
pnpm add @tanstack/workflow-core @tanstack/workflow-runtime \
  @tanstack/workflow-store-drizzle-postgres drizzle-orm pg zod
```

Add one host adapter when you deploy:

```bash
pnpm add @tanstack/workflow-vercel
# or
pnpm add @tanstack/workflow-netlify
```

## Define a workflow

Workflows are ordinary async functions. Side effects go through `ctx.step`, and
pauses go through `ctx.waitForEvent`, `ctx.approve`, `ctx.sleep`, or
`ctx.sleepUntil`.

```ts
import { createWorkflow } from '@tanstack/workflow-core'
import { z } from 'zod'

export const fulfillmentWorkflow = createWorkflow({
  id: 'fulfillment',
  input: z.object({
    orderId: z.string(),
    delayMs: z.number(),
  }),
  output: z.object({
    orderId: z.string(),
    shipped: z.boolean(),
  }),
}).handler(async (ctx) => {
  await ctx.step('reserve-inventory', async (stepCtx) => {
    await reserveInventory(ctx.input.orderId, {
      idempotencyKey: stepCtx.id,
    })
  })

  const now = await ctx.now()
  await ctx.sleepUntil(now + ctx.input.delayMs)

  const payment = await ctx.waitForEvent<{ paymentId: string }>(
    'payment-received',
  )

  await ctx.step('ship-order', async (stepCtx) => {
    await shipOrder(ctx.input.orderId, payment.paymentId, {
      idempotencyKey: stepCtx.id,
    })
  })

  return {
    orderId: ctx.input.orderId,
    shipped: true,
  }
})
```

The workflow can pause for seconds, days, or months. It does not keep a function
invocation alive while it waits. The handler reaches a pause, persists its state,
and returns. A later invocation resumes it.

## Create a runtime

The runtime registers workflows, owns schedules, and drives executions through a
durable execution store.

```ts
import {
  defineWorkflowRuntime,
  every,
  inMemoryWorkflowExecutionStore,
} from '@tanstack/workflow-runtime'
import { fulfillmentWorkflow } from './fulfillment'

const store = inMemoryWorkflowExecutionStore()

export const workflowRuntime = defineWorkflowRuntime({
  store,
  workflows: {
    fulfillment: {
      load: async () => fulfillmentWorkflow,
      schedules: [
        {
          id: 'fulfillment-digest-every-15m',
          schedule: every.minutes(15),
          overlapPolicy: 'skip',
          input: { batchSize: 100 },
        },
      ],
    },
  },
})
```

Use the in-memory store for tests and demos only. Production deployments need a
store that can persist executions across invocations.

## Use Postgres for durability

The first production-style store is Drizzle/Postgres:

```ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { createDrizzlePostgresWorkflowStore } from '@tanstack/workflow-store-drizzle-postgres'

const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }))
const store = createDrizzlePostgresWorkflowStore({ db })

await store.ensureSchema()
```

Then pass `store` to `defineWorkflowRuntime`. The runtime will use it for:

- run creation and idempotency
- append-only event logs
- run state and pause metadata
- timers
- schedule buckets
- signal and approval delivery
- leases and stale run recovery

Drizzle is the SQL execution surface. The workflow runtime is backed by the
`WorkflowExecutionStore` contract.

## Start and resume runs

Use `runtime.startRun` to start a new execution:

```ts
await workflowRuntime.startRun({
  workflowId: 'fulfillment',
  runId: `fulfillment:${orderId}`,
  input: { orderId, delayMs: 30_000 },
})
```

Deliver external events with a stable `signalId`:

```ts
await workflowRuntime.deliverSignal({
  runId: `fulfillment:${orderId}`,
  signalId: stripeEvent.id,
  name: 'payment-received',
  payload: { paymentId: stripeEvent.data.object.id },
})
```

Deliver approvals the same way:

```ts
await workflowRuntime.deliverApproval({
  runId,
  approval: {
    approvalId,
    approved: true,
    feedback: 'Approved by finance',
  },
})
```

Stable IDs matter. Retries from Stripe, a webhook queue, or a user clicking twice
should use the same `signalId` or `approvalId` so delivery is idempotent.

## Wake timers and schedules

The runtime can sleep and schedule without owning a process. It uses a sweep:

```ts
await workflowRuntime.sweep({
  maxScheduledRuns: 25,
  maxTimers: 25,
  maxDurationMs: 55_000,
  includeEvents: false,
})
```

A sweep does two jobs:

1. Claim due schedule buckets and start their workflow runs.
2. Claim due timers and deliver the internal `__timer` signal to paused runs.

The result is summary-first:

```ts
{
  scheduled: [],
  timers: [],
  summary: {
    scheduled: { completed: 3 },
    timers: { paused: 12 },
    eventCount: 88,
    returnedEventCount: 0,
  },
  deadlineReached: false,
  remainingMayExist: false,
}
```

By default, host adapters set `includeEvents: false` so a busy sweep does not
retain every emitted event in memory. Use `includeSweepResult` or `includeEvents`
only when debugging.

## Deploy on Vercel

Create a route handler:

```ts
// app/api/workflow/sweep/route.ts
import { createVercelWorkflowSweepHandler } from '@tanstack/workflow-vercel'
import { workflowRuntime } from '@/workflows/runtime.server'

export const runtime = 'nodejs'
export const maxDuration = 60

export const GET = createVercelWorkflowSweepHandler({
  runtime: workflowRuntime,
  cronSecret: process.env.CRON_SECRET,
  maxDurationMs: 55_000,
})
```

Configure Vercel Cron:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [
    {
      "path": "/api/workflow/sweep",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

The Vercel Cron Job wakes the route. The database decides what is actually due.

## Deploy on Netlify

Create a Scheduled Function:

```ts
// netlify/functions/workflow-sweep-background.ts
import {
  createNetlifyWorkflowSweepConfig,
  createNetlifyWorkflowSweepHandler,
} from '@tanstack/workflow-netlify'
import { workflowRuntime } from '../../src/workflows/runtime.server'

export default createNetlifyWorkflowSweepHandler({
  runtime: workflowRuntime,
  maxDurationMs: 25_000,
})

export const config = createNetlifyWorkflowSweepConfig({
  schedule: '*/5 * * * *',
})
```

The Scheduled Function only wakes the runtime. It does not store workflow state.

## Why this works on serverless hosts

Every host invocation has a bounded responsibility:

- start a run and drive it to the next pause
- deliver one signal or approval and drive to the next pause
- sweep a bounded number of due timers and schedules

No invocation has to outlive the host's function limit. Long-lived means the
workflow execution can span time. It does not mean one JavaScript process stays
alive.

## Production checklist

- Use a durable `WorkflowExecutionStore`.
- Use stable `runId`, `signalId`, approval IDs, and step IDs.
- Put all side effects inside `ctx.step`.
- Configure host cron or scheduled functions to call a bounded sweep.
- Set `maxDurationMs` below the host function timeout.
- Keep `includeEvents: false` for normal sweeps.
- Treat `remainingMayExist: true` as a signal to schedule or allow another
  sweep.
- Keep previous workflow versions loadable until old runs finish.
- Add observability around sweep summaries, errors, and stale lease recovery.

## Next

- [Runtime model](runtime-model.md)
- [Persistence](persistence.md)
- [Deployment](deployment.md)
- [Cookbook](../cookbook/index.md)
- [API reference](../api/index.md)
