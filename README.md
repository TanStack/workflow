# TanStack Workflow

Type-safe durable execution for TypeScript. Workflows are ordinary async functions that can pause, persist progress to an append-only log, and resume after approvals, webhooks, timers, or process restarts.

```bash
pnpm add @tanstack/workflow-core
```

Install `zod` or another Standard Schema-compatible library if you want runtime validation for workflow inputs, outputs, state, or signal payloads.

## Example

```ts
import {
  createWorkflow,
  inMemoryRunStore,
  runWorkflow,
} from '@tanstack/workflow-core'
import { z } from 'zod'

const checkout = createWorkflow({
  id: 'checkout',
  input: z.object({ userId: z.string(), amount: z.number() }),
  output: z.object({ status: z.enum(['approved', 'rejected']) }),
}).handler(async (ctx) => {
  const charge = await ctx.step('charge-card', (stepCtx) =>
    stripe.charges.create(
      { customer: ctx.input.userId, amount: ctx.input.amount },
      { idempotencyKey: stepCtx.id },
    ),
  )

  if (ctx.input.amount > 10_000) {
    const decision = await ctx.approve({ title: 'Approve large charge?' })
    if (!decision.approved) return { status: 'rejected' as const }
  }

  await ctx.step('send-receipt', () => sendReceipt(charge.id))
  return { status: 'approved' as const }
})

const store = inMemoryRunStore()

for await (const event of runWorkflow({
  workflow: checkout,
  input: { userId: 'cus_123', amount: 4200 },
  runStore: store,
})) {
  console.log(event.type, event)
}
```

## Core Ideas

- Side effects live inside `ctx.step(id, fn)`, which records results and skips re-execution on replay.
- `ctx.waitForEvent`, `ctx.approve`, `ctx.sleep`, and `ctx.sleepUntil` pause runs until the host delivers a matching signal or approval.
- `ctx.now()` and `ctx.uuid()` record deterministic values for replay.
- Middleware can extend `ctx` with typed dependencies such as users, database handles, or tracing.
- Storage is pluggable through `RunStore`; the package ships an in-memory store for local development and tests.

## Packages

- `@tanstack/workflow-core`: engine, workflow builder, middleware, event types, request parsing helpers, version routing, and in-memory `RunStore`.

Storage adapters, framework bindings, and devtools are planned as follow-up packages.

## Development

```bash
pnpm install
pnpm --filter @tanstack/workflow-core test:lib
pnpm --filter @tanstack/workflow-core test:types
pnpm --filter @tanstack/workflow-core build
pnpm test
```

## Docs

- [Overview](./docs/overview.md)
- [Installation](./docs/installation.md)
- [Quick start](./docs/quick-start.md)
- [Primitives](./docs/concepts/primitives.md)
- [Replay and resume](./docs/concepts/replay-and-resume.md)
- [Scheduling](./docs/concepts/scheduling.md)

## License

MIT
