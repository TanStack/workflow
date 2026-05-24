---
id: InferSchema
title: InferSchema
---

# Type Alias: InferSchema\<T\>

```ts
type InferSchema<T> = T extends StandardSchemaV1<infer _, infer Out> ? Out : never;
```

Defined in: [packages/workflow-core/src/types.ts:9](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L9)

## Type Parameters

### T

`T`
