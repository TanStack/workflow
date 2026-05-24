---
id: CreateMiddlewareBuilder
title: CreateMiddlewareBuilder
---

# Interface: CreateMiddlewareBuilder\<TCtxIn\>

Defined in: [packages/workflow-core/src/middleware/create-middleware.ts:7](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/middleware/create-middleware.ts#L7)

## Type Parameters

### TCtxIn

`TCtxIn`

## Properties

### server()

```ts
server: <TExtension>(fn) => Middleware<TCtxIn, AssertNonReservedExtension<TExtension>>;
```

Defined in: [packages/workflow-core/src/middleware/create-middleware.ts:20](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/middleware/create-middleware.ts#L20)

Provide the server-side middleware function. Receives the
current `ctx` and a `next` callback that takes the additional
fields to merge into the ctx for downstream middleware and the
handler.

    const requireUser = createMiddleware().server(async ({ next }) => {
      const user = await loadUser()
      if (!user) throw new Error('unauthorized')
      return next({ context: { user } })
    })

#### Type Parameters

##### TExtension

`TExtension`

#### Parameters

##### fn

[`MiddlewareServerFn`](../type-aliases/MiddlewareServerFn.md)\<`TCtxIn`, [`AssertNonReservedExtension`](../type-aliases/AssertNonReservedExtension.md)\<`TExtension`\>\>

#### Returns

[`Middleware`](Middleware.md)\<`TCtxIn`, [`AssertNonReservedExtension`](../type-aliases/AssertNonReservedExtension.md)\<`TExtension`\>\>
