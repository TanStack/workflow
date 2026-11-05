# @tanstack/workflow-railway

Railway host adapter for TanStack Workflow.

See the main [Deployment guide](../../docs/guide/deployment.md) and
[Host adapters API](../../docs/api/host-adapters.md).

The adapter creates a bounded cron command for Railway Cron Jobs. Railway starts
the service on a crontab expression, the command calls `runtime.sweep()`, and
the process should exit when the command resolves.

```ts
import { createRailwayWorkflowCronCommand } from '@tanstack/workflow-railway'
import { workflowRuntime } from './workflows/runtime.server'

const sweep = createRailwayWorkflowCronCommand({
  runtime: workflowRuntime,
  maxScheduledRuns: 25,
  maxTimers: 25,
  maxDurationMs: 55_000,
  logSummary: true,
})

await sweep()
```

Configure the cron job in Railway config-as-code:

```toml
# railway.toml
[deploy]
startCommand = "pnpm workflow:sweep"
cronSchedule = "*/5 * * * *"
restartPolicyType = "NEVER"
```

Railway skips a cron run if the previous one is still running. Keep leases and
idempotency in the store because retries, deploys, and manual runs can still
race.
