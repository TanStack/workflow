# @tanstack/workflow-vercel

Experimental Vercel host adapter for TanStack Workflow.

See the main [Deployment guide](../../docs/guide/deployment.md) and
[Host adapters API](../../docs/api/host-adapters.md).

The adapter wires a `WorkflowRuntimeDefinition` into a Vercel Function. It
materializes registered workflow schedules into the runtime store, then calls
`runtime.sweep()` to run due scheduled workflows and resume due timers.

```ts
// app/api/workflow/sweep/route.ts
import { createVercelWorkflowSweepHandler } from '@tanstack/workflow-vercel'
import { workflowRuntime } from '../../../../src/workflows/runtime.server'

export const runtime = 'nodejs'
export const maxDuration = 60

export const GET = createVercelWorkflowSweepHandler({
  runtime: workflowRuntime,
  cronSecret: process.env.CRON_SECRET,
  maxDurationMs: 55_000,
})
```

Configure the Vercel Cron Job in `vercel.json`:

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

Vercel Cron Jobs invoke the configured path with an HTTP `GET` request. If the
project defines `CRON_SECRET`, Vercel sends it in the `Authorization` header,
and the handler can validate it with `cronSecret`.

Workflow schedules stay in the runtime registration:

```ts
import { defineWorkflowRuntime, every } from '@tanstack/workflow-runtime'

export const workflowRuntime = defineWorkflowRuntime({
  store,
  workflows: {
    'intent-process': {
      load: async () => intentProcessWorkflow,
      schedules: [
        {
          id: 'intent-process-every-15m',
          schedule: every.minutes(15),
          overlapPolicy: 'skip',
          input: { batchSize: 50 },
        },
      ],
    },
  },
})
```

Vercel Hobby projects only support daily cron invocations. For minute-level
sweeps, deploy on a plan that supports per-minute cron jobs or use a daily
host cron as a coarse wake-up for schedules that tolerate that cadence.
