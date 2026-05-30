---
id: Middleware
title: Middleware
---

# Interface: Middleware\<TCtxIn, TExtension\>

Defined in: [packages/workflow-core/src/types.ts:404](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L404)

## Type Parameters

### TCtxIn

`TCtxIn` = `unknown`

### TExtension

`TExtension` = `unknown`

## Properties

### \_\_kind

```ts
__kind: "middleware";
```

Defined in: [packages/workflow-core/src/types.ts:405](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L405)

***

### server

```ts
server: MiddlewareServerFn<TCtxIn, TExtension>;
```

Defined in: [packages/workflow-core/src/types.ts:406](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L406)
