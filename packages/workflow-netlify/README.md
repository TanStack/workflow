# @tanstack/workflow-netlify

Experimental Netlify host adapter for TanStack Workflow.

See the main [Deployment guide](../../docs/guide/deployment.md) and
[Host adapters API](../../docs/api/host-adapters.md).

The adapter wires a `WorkflowRuntimeDefinition` into a single Netlify scheduled
function. It materializes registered workflow schedules into the runtime store,
then calls `runtime.sweep()` to run due scheduled workflows and resume due
timers.

```ts
// netlify/functions/workflow-sweep-background.ts
import { createNetlifyWorkflowSweepHandler } from '@tanstack/workflow-netlify'
import { workflowRuntime } from '../../src/workflows/runtime.server'

export default createNetlifyWorkflowSweepHandler({
  runtime: workflowRuntime,
})

export const config = {
  schedule: '*/5 * * * *',
}
```

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
