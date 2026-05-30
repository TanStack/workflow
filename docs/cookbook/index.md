---
id: cookbook
title: Cookbook
---

# Cookbook

Short recipes for the common things you wire around TanStack Workflow.

## Install packages

Local development:

```bash
pnpm add @tanstack/workflow-core @tanstack/workflow-runtime zod
```

Postgres deployment:

```bash
pnpm add @tanstack/workflow-core @tanstack/workflow-runtime \
  @tanstack/workflow-store-drizzle-postgres drizzle-orm pg zod
```

Netlify:

```bash
pnpm add @tanstack/workflow-netlify
```

Vercel:

```bash
pnpm add @tanstack/workflow-vercel
```

## Create a workflow

```ts
import { createWorkflow } from '@tanstack/workflow-core'
import { z } from 'zod'

export const chargeWorkflow = createWorkflow({
  id: 'charge',
  input: z.object({ userId: z.string(), amount: z.number() }),
}).handler(async (ctx) => {
  const charge = await ctx.step('charge-card', (stepCtx) =>
    stripe.charges.create(
      { customer: ctx.input.userId, amount: ctx.input.amount },
      { idempotencyKey: stepCtx.id },
    ),
  )

  return { chargeId: charge.id }
})
```

## Create a local runtime

```ts
import {
  defineWorkflowRuntime,
  inMemoryWorkflowExecutionStore,
} from '@tanstack/workflow-runtime'
import { chargeWorkflow } from './charge'

export const workflowRuntime = defineWorkflowRuntime({
  store: inMemoryWorkflowExecutionStore(),
  workflows: {
    charge: {
      load: async () => chargeWorkflow,
    },
  },
})
```

## Create a Postgres runtime

```ts
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { defineWorkflowRuntime } from '@tanstack/workflow-runtime'
import { createDrizzlePostgresWorkflowStore } from '@tanstack/workflow-store-drizzle-postgres'

const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }))
const store = createDrizzlePostgresWorkflowStore({ db })

export const workflowRuntime = defineWorkflowRuntime({
  store,
  workflows: {
    charge: {
      load: () => import('./charge').then((mod) => mod.chargeWorkflow),
    },
  },
})
```

## Apply workflow store migrations

Workflow owns its durable store schema. Apply the package-owned SQL migration
during setup/deploy instead of copying `workflow_*` tables into your app's
Drizzle schema.

```bash
psql "$DATABASE_URL" -f node_modules/@tanstack/workflow-store-drizzle-postgres/migrations/0000_workflow_store.sql
```

If your deploy system wants a package script:

```json
{
  "scripts": {
    "workflow:migrate": "psql \"$DATABASE_URL\" -f node_modules/@tanstack/workflow-store-drizzle-postgres/migrations/0000_workflow_store.sql"
  }
}
```

Run this against the same `DATABASE_URL` your deployed functions use. Keep
`store.ensureSchema()` for tests, local demos, and explicit admin bootstrap
scripts.

The migration records itself in `workflow_schema_migrations`. Future Workflow
store schema changes will ship as additional numbered SQL files in the adapter
package.

## Start a run from HTTP

```ts
export async function POST(request: Request) {
  const input = await request.json()
  const runId = `charge:${input.orderId}`

  const result = await workflowRuntime.startRun({
    workflowId: 'charge',
    runId,
    input,
    includeEvents: false,
  })

  return Response.json({
    runId,
    kind: result.kind,
  })
}
```

## Wait for a webhook

Workflow:

```ts
const payment = await ctx.waitForEvent<{ paymentId: string }>(
  'payment-received',
)
```

Webhook:

```ts
export async function POST(request: Request) {
  const event = await request.json()

  const result = await workflowRuntime.deliverSignal({
    runId: `checkout:${event.orderId}`,
    signalId: event.id,
    name: 'payment-received',
    payload: { paymentId: event.paymentId },
    includeEvents: false,
  })

  return Response.json({ kind: result.kind })
}
```

## Wait for approval

Workflow:

```ts
const decision = await ctx.approve({
  title: 'Approve refund?',
  description: `Refund ${ctx.input.amount}`,
})

if (!decision.approved) {
  return { status: 'rejected' as const }
}
```

Approval handler:

```ts
await workflowRuntime.deliverApproval({
  runId,
  approval: {
    approvalId,
    approved: true,
    feedback: 'Approved in admin',
  },
})
```

## Sleep and wake later

Workflow:

```ts
const now = await ctx.now()
await ctx.sleepUntil(now + 30 * 60_000)
```

Sweep:

```ts
await workflowRuntime.sweep({
  maxTimers: 25,
  maxDurationMs: 55_000,
  includeEvents: false,
})
```

## Register a recurring schedule

```ts
import { defineWorkflowRuntime, every } from '@tanstack/workflow-runtime'

export const workflowRuntime = defineWorkflowRuntime({
  store,
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
  },
})
```

The host sweep materializes due schedules and starts deterministic runs.

## Use a cron expression

```ts
import { cron } from '@tanstack/workflow-runtime'

{
  id: 'weekly-report',
  schedule: cron('0 9 * * 1', { timezone: 'UTC' }),
  overlapPolicy: 'skip',
}
```

Current materialization supports numeric five-field UTC cron schedules.

## Run a bounded sweep

```ts
const result = await workflowRuntime.sweep({
  maxScheduledRuns: 10,
  maxTimers: 50,
  maxDurationMs: 25_000,
  includeEvents: false,
})

console.log(result.summary)

if (result.remainingMayExist) {
  // Let the next cron tick continue, or enqueue another sweep.
}
```

## Debug a sweep

```ts
const result = await workflowRuntime.sweep({
  includeEvents: true,
  maxEvents: 100,
})

console.log(result.scheduled[0]?.events)
```

Do this in development or admin tooling, not on every production cron response.

## Cloudflare scheduled worker

```ts
import { createCloudflareWorkflowScheduledHandler } from '@tanstack/workflow-cloudflare'

export default {
  scheduled: createCloudflareWorkflowScheduledHandler({
    runtime: ({ env }) => createWorkflowRuntime(env),
    maxScheduledRuns: 25,
    maxTimers: 25,
    maxDurationMs: 25_000,
  }),
}
```

## Railway cron command

```ts
// scripts/workflow-sweep.ts
import { createRailwayWorkflowCronCommand } from '@tanstack/workflow-railway'
import { workflowRuntime } from '../src/workflows/runtime.server'

const sweep = createRailwayWorkflowCronCommand({
  runtime: workflowRuntime,
  maxScheduledRuns: 25,
  maxTimers: 25,
  maxDurationMs: 55_000,
  logSummary: true,
})

await sweep()
```

Configure Railway Cron Jobs with config-as-code:

```toml
# railway.toml
[deploy]
startCommand = "pnpm workflow:sweep"
cronSchedule = "*/5 * * * *"
restartPolicyType = "NEVER"
```

## Netlify scheduled function

```ts
// netlify/functions/workflow-sweep-background.ts
import {
  createNetlifyWorkflowSweepHandler,
} from '@tanstack/workflow-netlify'
import { workflowRuntime } from '../../src/workflows/runtime.server'

export default createNetlifyWorkflowSweepHandler({
  runtime: workflowRuntime,
  maxDurationMs: 25_000,
})

export const config = {
  schedule: '*/5 * * * *',
}
```

## Vercel sweep route

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

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/workflow/sweep", "schedule": "*/5 * * * *" }]
}
```

## Lazy load workflow code

```ts
workflows: {
  fulfillment: {
    load: () =>
      import('./fulfillment').then((mod) => mod.fulfillmentWorkflow),
  },
}
```

Lazy loaders keep adapters from importing every workflow up front and make old
versions explicit.

## Keep old versions resumable

```ts
workflows: {
  fulfillment: {
    version: 'v2',
    load: () => import('./fulfillment.v2').then((mod) => mod.workflow),
    previousVersions: {
      v1: () => import('./fulfillment.v1').then((mod) => mod.workflow),
    },
  },
}
```

Remove `v1` only after every `v1` run has finished or errored.

## Customize schedule materialization

```ts
import { materializeWorkflowSchedules } from '@tanstack/workflow-runtime'

await materializeWorkflowSchedules(workflowRuntime, {
  now: Date.now(),
  cronLookbackMs: 24 * 60 * 60 * 1000,
})
```

Most users should let the host adapter call this automatically.

## Return a compact cron response

Host adapters default to compact responses:

```json
{
  "ok": true,
  "summary": {
    "materialized": 1,
    "scheduled": { "completed": 1 },
    "timers": {},
    "eventCount": 8,
    "returnedEventCount": 0
  },
  "deadlineReached": false,
  "remainingMayExist": false
}
```

The full sweep result is optional:

```ts
createVercelWorkflowSweepHandler({
  runtime,
  includeSweepResult: true,
  includeEvents: true,
})
```
