---
id: Middleware
title: Middleware
---

# Interface: Middleware\<TCtxIn, TExtension\>

Defined in: [packages/workflow-core/src/types.ts:463](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L463)

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

Defined in: [packages/workflow-core/src/types.ts:464](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L464)

***

### server

```ts
server: MiddlewareServerFn<TCtxIn, TExtension>;
```

Defined in: [packages/workflow-core/src/types.ts:465](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L465)
