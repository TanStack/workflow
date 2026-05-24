---
id: AccumulateExtensions
title: AccumulateExtensions
---

# Type Alias: AccumulateExtensions\<TMiddlewares\>

```ts
type AccumulateExtensions<TMiddlewares> = UnionToIntersection<TMiddlewares[number] extends Middleware<any, infer TExtension> ? TExtension : never>;
```

Defined in: [packages/workflow-core/src/define/define-workflow.ts:31](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L31)

Walk an array of middlewares and intersect every extension type
they add to the ctx. Works for both tuple and plain-array
inference at the `.middleware([...])` call site.

## Type Parameters

### TMiddlewares

`TMiddlewares` *extends* `ReadonlyArray`\<[`AnyMiddleware`](AnyMiddleware.md)\>
