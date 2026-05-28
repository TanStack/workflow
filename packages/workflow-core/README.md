# @tanstack/workflow-core

Type-safe durable execution. Closure-based workflows with replay, pause/resume, typed middleware, and a pluggable event log.

```bash
pnpm add @tanstack/workflow-core zod
```

## Hello workflow

```ts
import {
  createWorkflow,
  inMemoryRunStore,
  runWorkflow,
} from '@tanstack/workflow-core'
import { z } from 'zod'

const greet = createWorkflow({
  id: 'greet',
  input: z.object({ name: z.string() }),
}).handler(async (ctx) => {
  const greeting = await ctx.step('build', () => `Hello, ${ctx.input.name}!`)
  return { greeting }
})

for await (const event of runWorkflow({
  workflow: greet,
  input: { name: 'world' },
  runStore: inMemoryRunStore(),
})) {
  console.log(event.type, event)
}
```

## What you get on `ctx`

| Field                                  | Type                       | Purpose                                                       |
| -------------------------------------- | -------------------------- | ------------------------------------------------------------- |
| `ctx.input`                            | typed from `input` schema  | request payload                                               |
| `ctx.state`                            | typed from `state` schema  | mutable; tracked between primitives, emitted as `STATE_DELTA` |
| `ctx.runId`                            | `string`                   | stable identifier; safe as an idempotency key                 |
| `ctx.signal`                           | `AbortSignal`              | run-level cancellation                                        |
| `ctx.step(id, fn, opts?)`              | `Promise<T>`               | durable side-effect with replay                               |
| `ctx.sleep(ms)` / `ctx.sleepUntil(ts)` | `Promise<void>`            | durable pause via `__timer` signal                            |
| `ctx.waitForEvent(name, opts?)`        | `Promise<TPayload>`        | pause until host delivers a signal                            |
| `ctx.approve({ title, description? })` | `Promise<ApprovalResult>`  | pause for human approval                                      |
| `ctx.now()` / `ctx.uuid()`             | `Promise<number / string>` | deterministic recorded values                                 |
| `ctx.emit(name, value)`                | `void`                     | observability-only custom event                               |

Middleware can add more.

## Pause and resume

```ts
// Run pauses at ctx.approve / ctx.waitForEvent. Capture runId, send a delivery.
const store = inMemoryRunStore()
const phase1 = await collect(runWorkflow({ workflow, input, runStore: store }))
const runId = findRunId(phase1)
const approvalId = phase1.find(
  (e) => e.type === 'APPROVAL_REQUESTED',
)!.approvalId

await collect(
  runWorkflow({
    workflow,
    runId,
    runStore: store,
    approval: { approvalId, approved: true },
    // — or —
    signalDelivery: {
      signalId: 'evt-1',
      name: 'manager-approval',
      payload: { ok: true },
    },
  }),
)
```

## Status

Pre-alpha. Public API stable in shape. The production runtime, Drizzle/Postgres
store, Vercel adapter, and Netlify adapter live in sibling experimental
packages. Bindings (React, Solid, Vue, Svelte), additional stores, and devtools
are still planned.

Extracted from [`@tanstack/ai-orchestration`](https://github.com/TanStack/ai/pull/542) (Alem Tuzlak + Tom Beckenham). AI-specific layers (agents, orchestrators) compose on top.

## Docs

- [docs/overview.md](../../docs/overview.md) — mental model
- [docs/quick-start.md](../../docs/quick-start.md) — copy-paste recipes
- [docs/concepts/primitives.md](../../docs/concepts/primitives.md) — one block per primitive
- [docs/concepts/middleware.md](../../docs/concepts/middleware.md) — typed ctx extension
- [docs/concepts/replay-and-resume.md](../../docs/concepts/replay-and-resume.md) — durability rules
- [docs/guide/index.md](../../docs/guide/index.md) — production runtime guide
- [docs/cookbook/index.md](../../docs/cookbook/index.md) — quick recipes
- [docs/api/index.md](../../docs/api/index.md) — hand-written package API reference
