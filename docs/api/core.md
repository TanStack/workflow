---
id: core-api
title: Core API
---

# Core API

`@tanstack/workflow-core` is the replay engine and authoring API.

## `createWorkflow`

Creates a workflow definition.

```ts
import { createWorkflow } from '@tanstack/workflow-core'

const workflow = createWorkflow({
  id: 'checkout',
  version: 'v1',
  input,
  output,
  state,
}).handler(async (ctx) => {
  return { ok: true }
})
```

Important config:

| Option | Purpose |
| --- | --- |
| `id` | Stable workflow ID. |
| `version` | Optional version persisted with started runs. |
| `input` | Optional Standard Schema validator for workflow input. |
| `output` | Optional Standard Schema validator for workflow output. |
| `state` | Optional Standard Schema validator for workflow state. |

## `ctx.step`

Runs a side effect durably.

```ts
const result = await ctx.step('charge-card', async (stepCtx) => {
  return stripe.charges.create(
    { amount: ctx.input.amount },
    { idempotencyKey: stepCtx.id },
  )
})
```

On replay, a completed step returns the recorded result and does not call the
function again.

Use `stepCtx.id` as the idempotency key for external systems.

## `ctx.waitForEvent`

Pauses until a signal is delivered.

```ts
const now = await ctx.now()
const payment = await ctx.waitForEvent<{ paymentId: string }>(
  'payment-received',
  {
    deadline: now + 24 * 60 * 60_000,
    meta: { orderId: ctx.input.orderId },
  },
)
```

Resume with `runWorkflow({ signalDelivery })` or
`runtime.deliverSignal(...)`.

## `ctx.approve`

Pauses until an approval is delivered.

```ts
const decision = await ctx.approve({
  title: 'Approve refund?',
  description: `Refund ${ctx.input.amount}`,
})
```

Resume with `runWorkflow({ approval })` or `runtime.deliverApproval(...)`.

## `ctx.sleep` and `ctx.sleepUntil`

Pauses until a timer deadline.

```ts
await ctx.sleep(30_000)
const now = await ctx.now()
await ctx.sleepUntil(now + 30_000)
```

In the runtime package, due timers are resumed by `runtime.sweep()`.

## `ctx.now` and `ctx.uuid`

Records deterministic values.

```ts
const now = await ctx.now()
const id = await ctx.uuid()
```

Use these instead of `Date.now()` and `crypto.randomUUID()` when the value
affects workflow control flow or output.

## `runWorkflow`

Low-level engine entrypoint.

```ts
for await (const event of runWorkflow({
  workflow,
  input,
  runId,
  runStore,
  signalDelivery,
  approval,
})) {
  console.log(event.type)
}
```

Use this directly for tests, custom runtimes, or advanced embedding. Use
`defineWorkflowRuntime` for the production runtime/store/sweep model.

## `handleWorkflowWebhook`

Stateless one-invocation helper around the same engine.

```ts
await handleWorkflowWebhook({
  workflow,
  runStore,
  payload: {
    runId,
    signalDelivery,
  },
})
```

## `createMiddleware`

Extends workflow context.

```ts
const auth = createMiddleware().server<{
  user: { id: string }
}>(async ({ next }) => {
  return next({ context: { user: await loadUser() } })
})

const workflow = createWorkflow({ id: 'authed' })
  .middleware([auth])
  .handler(async (ctx) => {
    return { userId: ctx.user.id }
  })
```

## Type helpers

```ts
import type {
  WorkflowInput,
  WorkflowOutput,
  WorkflowState,
} from '@tanstack/workflow-core'

type Input = WorkflowInput<typeof workflow>
type Output = WorkflowOutput<typeof workflow>
type State = WorkflowState<typeof workflow>
```

## Generated reference

For full generated types and interfaces, see
[Generated core reference](../reference/index.md).
