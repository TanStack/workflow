# Middleware

Middleware extends `ctx` with typed fields. Workflows declare them as an array — extensions accumulate.

## Recipe: extend ctx

```ts
import { createMiddleware } from '@tanstack/workflow-core'

const requireUser = createMiddleware().server<{
  user: { id: string; email: string }
}>(async ({ next }) => {
  const user = await loadUser()
  if (!user) throw new Error('unauthorized')
  return next({ context: { user } })
})
```

The generic on `.server<...>` is the extension shape. TS uses it to add `ctx.user` everywhere the middleware is registered.

## Recipe: register on a workflow

```ts
const wf = createWorkflow({ id: 'wf' })
  .middleware([requireUser])
  .handler(async (ctx) => {
    ctx.user.id   // typed
  })
```

## Recipe: middleware that wraps the handler

```ts
const traced = createMiddleware().server<{ trace: Trace }>(async ({ next }) => {
  const trace = startTrace()
  try {
    return await next({ context: { trace } })
  } finally {
    trace.end()
  }
})
```

`next` is called **once**. Code before runs pre-handler; code after runs post.

## Recipe: middleware that depends on a prior middleware

```ts
const requireUser = createMiddleware().server<{ user: User }>(
  async ({ next }) => next({ context: { user: await loadUser() } }),
)

// Reaches ctx.user — type the inbound ctx with the generic on createMiddleware.
const requirePro = createMiddleware<{ user: User }>().server<{ tier: 'pro' }>(
  async ({ ctx, next }) => {
    if (ctx.user.tier !== 'pro') throw new Error('pro required')
    return next({ context: { tier: 'pro' } })
  },
)

createWorkflow({ id: 'wf' })
  .middleware([requireUser, requirePro])  // order matters
  .handler(async (ctx) => {
    ctx.user           // from requireUser
    ctx.tier           // from requirePro
  })
```

## Recipe: typed helper that needs ctx fields

```ts
import type { WorkflowCtx } from '@tanstack/workflow-core'

async function sendReceipt(
  ctx: WorkflowCtx<{ user: User }>,
  amount: number,
) {
  await ctx.step('send-receipt', () => mailer.send(ctx.user.email, amount))
}
```

Pass the typed `ctx` to the helper — the constraint documents which middleware fields must be in scope.

## Rules

- `.middleware([a, b])` runs `a` first, then `b`, then the handler.
- Each middleware must call `next()` exactly once. Twice throws `RUN_ERRORED`.
- Middleware extensions cannot shadow reserved ctx fields (`input`, `state`, `runId`, `signal`, `step`, `sleep`, `sleepUntil`, `waitForEvent`, `approve`, `now`, `uuid`, `emit`). Type system rejects them; runtime guards too.

## Footguns

- **Implicit ctx inference fails.** The `.server<TExtension>(...)` generic is mandatory; bare `.server(fn)` defaults `TExtension` to `unknown` and ctx fields aren't visible.
- **Middleware errors abort the run.** A throw before `next()` skips the handler entirely; status becomes `errored`.
