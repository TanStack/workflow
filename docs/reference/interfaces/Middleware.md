---
id: Middleware
title: Middleware
---

# Interface: Middleware\<TCtxIn, TExtension\>

Defined in: [packages/workflow-core/src/types.ts:374](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L374)

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

Defined in: [packages/workflow-core/src/types.ts:375](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L375)

***

### server

```ts
server: MiddlewareServerFn<TCtxIn, TExtension>;
```

Defined in: [packages/workflow-core/src/types.ts:376](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L376)
