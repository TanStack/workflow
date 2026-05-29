---
id: host-adapters
title: Host Adapters
---

# Host adapters

Host adapters turn provider-native cron or scheduled function entrypoints into a
bounded `runtime.sweep()` call.

They are intentionally thin. Workflow semantics live in the runtime and store.

## Common behavior

Both Vercel and Netlify adapters:

- call `materializeWorkflowSchedules`
- call `runtime.sweep`
- default `includeEvents` to `false`
- return a compact JSON summary
- optionally include the full sweep result for debugging

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

### `createVercelWorkflowCronConfig`

Creates a `vercel.json`-compatible object:

```ts
createVercelWorkflowCronConfig({
  path: '/api/workflow/sweep',
  everyMinutes: 5,
})
```

Result:

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

You can also pass an explicit `schedule`.

### `vercelWorkflowCronConfig`

Default config:

```ts
{
  $schema: 'https://openapi.vercel.sh/vercel.json',
  crons: [{ path: '/api/workflow/sweep', schedule: '*/5 * * * *' }],
}
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

### `createNetlifyWorkflowSweepConfig`

Creates a Netlify Scheduled Function config:

```ts
export const config = createNetlifyWorkflowSweepConfig({
  everyMinutes: 5,
})
```

Result:

```ts
{ schedule: '*/5 * * * *' }
```

You can also pass an explicit `schedule`.

### `netlifyWorkflowSweepConfig`

Default config:

```ts
{ schedule: '*/5 * * * *' }
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
