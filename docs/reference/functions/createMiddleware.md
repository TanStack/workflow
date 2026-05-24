---
id: createMiddleware
title: createMiddleware
---

# Function: createMiddleware()

```ts
function createMiddleware<TCtxIn>(): CreateMiddlewareBuilder<TCtxIn>;
```

Defined in: [packages/workflow-core/src/middleware/create-middleware.ts:46](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/middleware/create-middleware.ts#L46)

Build a middleware that extends the workflow ctx. Type-level
accumulation makes the extension visible to downstream middleware
and the handler.

    const traced = createMiddleware().server(async ({ ctx, next }) => {
      const trace = startTrace(ctx.runId)
      try {
        return await next({ context: { trace } })
      } finally {
        trace.end()
      }
    })

For middleware that should compose on top of an already-extended
ctx, type the generic explicitly:

    createMiddleware<{ user: User }>().server(async ({ ctx, next }) => {
      // ctx.user is typed
    })

## Type Parameters

### TCtxIn

`TCtxIn` = `unknown`

## Returns

[`CreateMiddlewareBuilder`](../interfaces/CreateMiddlewareBuilder.md)\<`TCtxIn`\>
