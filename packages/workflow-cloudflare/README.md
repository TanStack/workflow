# @tanstack/workflow-cloudflare

Cloudflare host adapter for TanStack Workflow.

See the main [Deployment guide](../../docs/guide/deployment.md) and
[Host adapters API](../../docs/api/host-adapters.md).

The adapter wires a `WorkflowRuntimeDefinition` into a Cloudflare Worker
`scheduled()` handler. Cron Triggers wake the runtime; the durable store decides
which timers and schedule buckets are due.

```ts
import { createCloudflareWorkflowScheduledHandler } from '@tanstack/workflow-cloudflare'
import { workflowRuntime } from './workflows/runtime.server'

export default {
  scheduled: createCloudflareWorkflowScheduledHandler({
    runtime: workflowRuntime,
    maxScheduledRuns: 25,
    maxTimers: 25,
    maxDurationMs: 25_000,
  }),
}

// wrangler.json
// {
//   "triggers": { "crons": ["*/5 * * * *"] }
// }
```

Cloudflare-specific persistence adapters are separate capability packages. Use a
durable store such as D1, Durable Objects, Postgres, or another implementation
of the runtime store contract.
