---
id: host-adapters
title: Host Adapters
---

# Host adapters

Host adapters turn provider-native cron or scheduled function entrypoints into a
bounded `runtime.sweep()` call.

They are intentionally thin. Workflow semantics live in the runtime and store.
Documentation and adapter development should prioritize partner environments:
Cloudflare, Railway, and Netlify. Vercel remains an important compatibility
target, but examples should not make it the default host.

## Common behavior

Current packaged host adapters:

- call `materializeWorkflowSchedules`
- call `runtime.sweep`
- default `includeEvents` to `false`
- return a compact JSON summary
- optionally include the full sweep result for debugging

## Cloudflare

Install:

```bash
pnpm add @tanstack/workflow-cloudflare
```

### `createCloudflareWorkflowScheduledHandler`

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

Options:

| Option | Purpose |
| --- | --- |
| `runtime` | Required `WorkflowRuntimeDefinition`, or a function that creates one from `controller`, `env`, and `ctx`. |
| `now` | Optional timestamp provider. Defaults to `controller.scheduledTime`. |
| `leaseOwner` | String or function for worker identity. |
| `limit` | Shared fallback limit for schedules and timers. |
| `maxScheduledRuns` | Maximum schedule buckets to start. |
| `maxTimers` | Maximum timers to resume. |
| `maxDurationMs` | Sweep wall-clock budget. |
| `leaseMs` | Lease duration. |
| `includeEvents` | Whether retained run results include events. Defaults to false. |
| `maxEvents` | Maximum retained events per run result. |
| `includeSweepResult` | Include full sweep result in the returned object. Defaults to false. |
| `materializeSchedules` | Set false to skip schedule materialization. |
| `cronLookbackMs` | Lookback window for cron schedule materialization. |

Configure Cloudflare Cron Triggers directly in `wrangler.json` or
`wrangler.toml`. The adapter does not wrap that static platform config.

## Railway

Install:

```bash
pnpm add @tanstack/workflow-railway
```

### `createRailwayWorkflowCronCommand`

```ts
import { createRailwayWorkflowCronCommand } from '@tanstack/workflow-railway'

const sweep = createRailwayWorkflowCronCommand({
  runtime,
  maxScheduledRuns: 25,
  maxTimers: 25,
  maxDurationMs: 55_000,
  logSummary: true,
})

await sweep()
```

Options:

| Option | Purpose |
| --- | --- |
| `runtime` | Required `WorkflowRuntimeDefinition`. |
| `now` | Optional timestamp provider. |
| `leaseOwner` | String or function for worker identity. |
| `limit` | Shared fallback limit for schedules and timers. |
| `maxScheduledRuns` | Maximum schedule buckets to start. |
| `maxTimers` | Maximum timers to resume. |
| `maxDurationMs` | Sweep wall-clock budget. |
| `leaseMs` | Lease duration. |
| `includeEvents` | Whether retained run results include events. Defaults to false. |
| `maxEvents` | Maximum retained events per run result. |
| `includeSweepResult` | Include full sweep result in the returned object. Defaults to false. |
| `materializeSchedules` | Set false to skip schedule materialization. |
| `cronLookbackMs` | Lookback window for cron schedule materialization. |
| `logSummary` | `true` to log JSON summary, or a function to receive the result. |

Configure the Railway Cron Job directly in `railway.toml` or `railway.json`:

```toml
[deploy]
startCommand = "pnpm workflow:sweep"
cronSchedule = "*/5 * * * *"
restartPolicyType = "NEVER"
```

## Netlify

Install:

```bash
pnpm add @tanstack/workflow-netlify
```

### `createNetlifyWorkflowSweepHandler`

```ts
import { createNetlifyWorkflowSweepHandler } from '@tanstack/workflow-netlify'

export default createNetlifyWorkflowSweepHandler({
  runtime,
  maxScheduledRuns: 25,
  maxTimers: 25,
  maxDurationMs: 25_000,
})
```

Options:

| Option | Purpose |
| --- | --- |
| `runtime` | Required `WorkflowRuntimeDefinition`. |
| `now` | Optional timestamp provider. |
| `leaseOwner` | String or function for worker identity. |
| `limit` | Shared fallback limit for schedules and timers. |
| `maxScheduledRuns` | Maximum schedule buckets to start. |
| `maxTimers` | Maximum timers to resume. |
| `maxDurationMs` | Sweep wall-clock budget. |
| `leaseMs` | Lease duration. |
| `includeEvents` | Whether retained run results include events. Defaults to false. |
| `maxEvents` | Maximum retained events per run result. |
| `includeSweepResult` | Include full sweep result in JSON response. Defaults to false. |
| `materializeSchedules` | Set false to skip schedule materialization. |
| `cronLookbackMs` | Lookback window for cron schedule materialization. |

Export the Netlify Scheduled Function `config` object directly. Netlify needs
that object to be statically visible:

```ts
export const config = {
  schedule: '*/5 * * * *',
}
```

## Vercel

Install:

```bash
pnpm add @tanstack/workflow-vercel
```

### `createVercelWorkflowSweepHandler`

```ts
import { createVercelWorkflowSweepHandler } from '@tanstack/workflow-vercel'

export const GET = createVercelWorkflowSweepHandler({
  runtime,
  cronSecret: process.env.CRON_SECRET,
  maxScheduledRuns: 25,
  maxTimers: 25,
  maxDurationMs: 55_000,
})
```

Options:

| Option | Purpose |
| --- | --- |
| `runtime` | Required `WorkflowRuntimeDefinition`. |
| `now` | Optional timestamp provider. |
| `leaseOwner` | String or function for worker identity. |
| `limit` | Shared fallback limit for schedules and timers. |
| `maxScheduledRuns` | Maximum schedule buckets to start. |
| `maxTimers` | Maximum timers to resume. |
| `maxDurationMs` | Sweep wall-clock budget. |
| `leaseMs` | Lease duration. |
| `includeEvents` | Whether retained run results include events. Defaults to false. |
| `maxEvents` | Maximum retained events per run result. |
| `includeSweepResult` | Include full sweep result in JSON response. Defaults to false. |
| `materializeSchedules` | Set false to skip schedule materialization. |
| `cronLookbackMs` | Lookback window for cron schedule materialization. |
| `cronSecret` | Expected `Authorization: Bearer <secret>` value. |

Configure Vercel Cron directly in `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "crons": [{ "path": "/api/workflow/sweep", "schedule": "*/5 * * * *" }]
}
```

## Response shape

Successful adapters return:

```ts
interface SweepResponse {
  ok: true
  now: number
  leaseOwner: string
  materialized: ReadonlyArray<MaterializedWorkflowSchedule>
  summary: {
    materialized: number
    scheduled: Partial<Record<WorkflowRuntimeRunResultKind, number>>
    timers: Partial<Record<WorkflowRuntimeRunResultKind, number>>
    eventCount: number
    returnedEventCount: number
  }
  deadlineReached: boolean
  remainingMayExist: boolean
  sweep?: WorkflowRuntimeSweepResult
}
```

Use the summary for normal logs and monitoring. Include the full `sweep` only for
debugging.

## Re-exported schedule helpers

Both adapters re-export:

```ts
materializeWorkflowSchedules
```

and the related materialization types from `@tanstack/workflow-runtime`.
