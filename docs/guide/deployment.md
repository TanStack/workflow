---
title: Deployment | TanStack Workflow
---

# Deployment

TanStack Workflow is designed for normal deployment targets. A workflow can span
hours or months, but each host invocation should do bounded work and then return.

The deployment recipe is the same everywhere:

1. Put workflow state in a durable store.
2. Start or resume a run from HTTP, queue, webhook, or application code.
3. Use host cron, alarms, or scheduled functions to wake `runtime.sweep()`.
4. Keep every sweep under the host's timeout and memory budget.

## Invocation shapes

Most apps need three entrypoints:

| Entrypoint | Runtime call | Example |
| --- | --- | --- |
| Start a run | `runtime.startRun` | User action, API request, queue message |
| Resume a run | `runtime.deliverSignal` or `runtime.deliverApproval` | Webhook, payment event, admin approval |
| Wake background work | `runtime.sweep` | Cron, scheduled function, worker alarm |

Each entrypoint claims a run, drives it to completion or the next pause, and
returns.

## Bounded sweeps

Always budget background sweeps:

```ts
await runtime.sweep({
  maxScheduledRuns: 25,
  maxTimers: 25,
  maxDurationMs: 55_000,
  includeEvents: false,
})
```

Set `maxDurationMs` below the host's real timeout. If the sweep returns
`remainingMayExist: true`, another scheduled tick, queue message, or manual
follow-up can keep draining work.

## Vercel

Install:

```bash
pnpm add @tanstack/workflow-vercel
```

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
  maxScheduledRuns: 25,
  maxTimers: 25,
  maxDurationMs: 55_000,
})
```

Configure `vercel.json`:

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

When `CRON_SECRET` is configured, Vercel sends:

```http
Authorization: Bearer <CRON_SECRET>
```

The adapter validates that header when you pass `cronSecret`.

### Vercel notes

- Vercel Cron invokes the route with HTTP `GET`.
- Cron should wake the runtime, not hold workflow state.
- Vercel Hobby projects are limited to daily cron cadence. For minute-level
  sweeps, use a plan that supports the cadence or call the sweep through another
  scheduler.
- Use a durable external store such as Postgres. Function memory is not a store.

## Netlify

Install:

```bash
pnpm add @tanstack/workflow-netlify
```

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
  maxScheduledRuns: 25,
  maxTimers: 25,
  maxDurationMs: 25_000,
})

export const config = createNetlifyWorkflowSweepConfig({
  schedule: '*/5 * * * *',
})
```

The adapter returns a compact summary:

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

Use `includeSweepResult: true` only for debugging because it can return large
event arrays.

### Netlify notes

- Scheduled Functions are wake-up ticks.
- Published deploys own scheduled function execution.
- Use a durable external store such as Postgres, Netlify Database, Neon, or
  another store adapter.
- Keep `maxDurationMs` below the function timeout.

## Cloudflare

Cloudflare can run the same runtime shape with a Worker `scheduled()` handler:

```ts
export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    const runtime = createWorkflowRuntime(env)
    await runtime.sweep({
      now: event.scheduledTime,
      maxScheduledRuns: 25,
      maxTimers: 25,
      maxDurationMs: 25_000,
      includeEvents: false,
    })
  },
}
```

Cloudflare-specific store adapters are separate work. The current deployment
POC proves the host shape with Workers and Durable Objects.

## Choosing a sweep cadence

Sweep cadence is a product decision:

| Need | Suggested cadence |
| --- | --- |
| Daily digest or report | Daily or hourly |
| User-visible delayed actions | Every minute |
| Near-real-time timers | Queue plus frequent sweeps |
| Rare long sleeps | Coarse cron plus manual/event wake-ups |

The cadence controls how quickly due work is noticed. The store still controls
whether work is due and whether a worker can claim it.

## Queue integration

Queues are optional. They are useful for:

- fanning out heavy work after a sweep finds many due items
- retrying webhook delivery
- waking another sweep when `remainingMayExist` is true
- distributing starts and signals across workers

They are not the durability boundary. A queue message should point at a run,
timer, schedule bucket, or signal. The store remains the source of truth.

## Failure model

Assume:

- cron can deliver late
- cron can deliver twice
- a function can crash after a side effect
- a worker can time out before releasing a lease
- a webhook can retry
- a deploy can happen while runs are paused

The runtime/store model handles this with leases, idempotency keys, stable
workflow versions, and replay. Your application still needs idempotent external
side effects.

## Deployment checklist

- Configure a durable store and run schema migrations.
- Keep workflow loaders available for old versions.
- Add one sweep entrypoint per deployment target.
- Set host timeout and `maxDurationMs` together.
- Keep sweep event arrays disabled by default.
- Log `summary`, `deadlineReached`, and `remainingMayExist`.
- Alert on repeated stale lease recovery, sweep errors, and growing due timers.
- Smoke test start, sleep, timer sweep, signal delivery, and attach/read flows.
