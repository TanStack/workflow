---
'@tanstack/workflow-core': minor
---

Add `createWorkflowFactory` for sharing middleware and step-retry defaults across a family of workflows.

```ts
import { createWorkflowFactory } from '@tanstack/workflow-core'

const appWorkflow = createWorkflowFactory({
  defaultStepRetry: { maxAttempts: 3 },
}).middleware([traced, requireUser])

const onboard = appWorkflow({ id: 'onboard' })
  .middleware([requireEmailVerified]) // appended after factory mws
  .handler(async (ctx) => {
    /* ctx.trace, ctx.user, ctx.emailVerified */
  })
```

Factory middleware runs before per-workflow middleware; ctx extensions accumulate across both layers. Per-workflow config wins over factory defaults. `appWorkflow.extend({ ... })` forks a child factory with override defaults without mutating the parent.

See [docs/concepts/middleware.md](https://github.com/TanStack/workflow/blob/main/docs/concepts/middleware.md#recipe-share-middleware-across-a-family-of-workflows).
