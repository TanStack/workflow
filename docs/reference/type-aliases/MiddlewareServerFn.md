---
id: MiddlewareServerFn
title: MiddlewareServerFn
---

# Type Alias: MiddlewareServerFn()\<TCtxIn, TExtension\>

```ts
type MiddlewareServerFn<TCtxIn, TExtension> = (args) => Promise<unknown>;
```

Defined in: [packages/workflow-core/src/types.ts:369](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L369)

A middleware extends the ctx for downstream middleware + the
handler. The function receives the *current* `ctx` and a `next`
callable taking `{ context: TExtension }` — the literal `context`
field is what TypeScript anchors on to infer `TExtension` from the
call site.

    const requireUser = createMiddleware().server(async ({ ctx, next }) => {
      const user = await loadUser()
      return next({ context: { user } })
      // downstream ctx is now `prev & { user: User }`
    })

## Type Parameters

### TCtxIn

`TCtxIn`

### TExtension

`TExtension`

## Parameters

### args

#### ctx

`TCtxIn`

#### next

(`opts`) => `Promise`\<`unknown`\>

## Returns

`Promise`\<`unknown`\>
