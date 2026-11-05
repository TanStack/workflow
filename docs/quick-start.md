---
id: quick-start
title: Quick Start
---

Minimal recipes for `@tanstack/workflow-core` + `zod`. Snippets use small local helpers like `collect(...)` and `findRunId(...)` when they need to drain an event stream.

## Install

```bash
pnpm add @tanstack/workflow-core zod
```

## Recipe: a workflow that does one thing

```ts
import { createWorkflow, inMemoryRunStore, runWorkflow } from '@tanstack/workflow-core'
import { z } from 'zod'

const charge = createWorkflow({
  id: 'charge',
  input: z.object({ amount: z.number(), userId: z.string() }),
}).handler(async (ctx) => {
  const result = await ctx.step('stripe-charge', (stepCtx) =>
    stripe.charges.create(
      { amount: ctx.input.amount, customer: ctx.input.userId },
      { idempotencyKey: stepCtx.id },
    ),
  )
  return { chargeId: result.id }
})

for await (const event of runWorkflow({
  workflow: charge,
  input: { amount: 4200, userId: 'cus_123' },
  runStore: inMemoryRunStore(),
})) {
  // event is the unified WorkflowEvent union — durable AND observable
}
```

`stepCtx.id` is the **deterministic per-step ID** — use it as the idempotency key on the external system.

## Recipe: pause for human approval

```ts
const order = createWorkflow({
  id: 'order',
  input: z.object({ amount: z.number() }),
}).handler(async (ctx) => {
  if (ctx.input.amount > 1000) {
    const decision = await ctx.approve({ title: 'Approve large order?' })
    if (!decision.approved) return { status: 'rejected' as const }
  }
  return { status: 'approved' as const, runId: ctx.runId }
})

// Start — pauses on ctx.approve
const store = inMemoryRunStore()
const start = await collect(runWorkflow({ workflow: order, input: { amount: 1500 }, runStore: store }))
const runId = findRunId(start)
const approvalId = start.find((e) => e.type === 'APPROVAL_REQUESTED')!.approvalId

// Resume — same workflow, same runStore, new approval delivery
await collect(runWorkflow({
  workflow: order,
  runId,
  runStore: store,
  approval: { approvalId, approved: true },
}))
```

## Recipe: wait for an external event

```ts
import { z } from 'zod'

const checkout = createWorkflow({ id: 'checkout' }).handler(async (ctx) => {
  const now = await ctx.now()
  const payment = await ctx.waitForEvent('payment-completed', {
    schema: z.object({ amount: z.number(), reference: z.string() }),
    meta: { sessionId: ctx.runId }, // shown to UI / driver
    deadline: now + 24 * 60 * 60_000, // host wakes if not delivered
  })
  return { paid: payment.amount, ref: payment.reference }
})

// Driver / webhook calls this when payment lands:
await collect(runWorkflow({
  workflow: checkout,
  runId,
  runStore: store,
  signalDelivery: {
    signalId: 'stripe-evt-1',
    name: 'payment-completed',
    payload: { amount: 4200, reference: 'pi_xyz' },
  },
}))
```

Schema validates the payload before resuming.

## Recipe: middleware that extends ctx

```ts
import { createMiddleware } from '@tanstack/workflow-core'

const requireUser = createMiddleware().server<{
  user: { id: string; email: string }
}>(async ({ next }) => {
  return next({ context: { user: await loadUserFromCookie() } })
})

const wf = createWorkflow({ id: 'send-receipt' })
  .middleware([requireUser])
  .handler(async (ctx) => {
    // ctx.user is now typed
    await ctx.step('email', () => sendReceipt(ctx.user.email))
    return { ok: true }
  })
```

Specify the extension type as the generic on `.server<...>` — TS infers everything else.

## Recipe: cross-version resume

```ts
// Existing runs were started under v1. New code is v2.
const v2 = createWorkflow({ id: 'pipeline', version: 'v2' })
  .previousVersions([v1])      // keep v1 code reachable for in-flight runs
  .handler(async (ctx) => { /* v2 body */ })

// Engine reads workflowVersion from RunState and routes to the matching code.
// startEvents are the events from the original v1 run.
const approvalId = startEvents.find((e) => e.type === 'APPROVAL_REQUESTED')!.approvalId
await collect(runWorkflow({
  workflow: v2,                // current version
  runId,                       // started under v1
  runStore: store,
  approval: { approvalId, approved: true },
}))
```

## Recipe: tail a run from another node

```ts
runWorkflow({
  workflow,
  input,
  runStore,
  publish: async (runId, event) => {
    await redis.publish(`run:${runId}`, JSON.stringify(event))
  },
})
```

Subscribers on other nodes consume the Redis channel and rebuild the UI. The `publish` hook is best-effort — errors are swallowed.

## Recipe: webhook-driven execution

```ts
import { handleWorkflowWebhook } from '@tanstack/workflow-core'

// HTTP handler called by Durable Streams / queue / any push transport
app.post('/wf/:runId/event', async (req, res) => {
  await handleWorkflowWebhook({
    workflow,
    runStore,
    payload: {
      runId: req.params.runId,
      signalDelivery: req.body.signal,
      approval: req.body.approval,
    },
  })
  res.status(204).end()
})
```

Same engine as `runWorkflow`, but optimized for stateless one-invocation drives.

## Recipe: reuse output types

```ts
import type { WorkflowOutput, WorkflowInput, WorkflowState } from '@tanstack/workflow-core'

type CheckoutOutput = WorkflowOutput<typeof checkout> // { paid: number; ref: string }
type CheckoutInput  = WorkflowInput<typeof checkout>
type CheckoutState  = WorkflowState<typeof checkout>
```

Pass these to clients / consumers; the workflow remains the single source of truth.

## Where next

- [Guide](guide/index.md)
- [Cookbook](cookbook/index.md)
- [API reference](api/index.md)
- [Primitives reference](concepts/primitives.md)
- [Middleware](concepts/middleware.md)
- [Replay and resume](concepts/replay-and-resume.md)
