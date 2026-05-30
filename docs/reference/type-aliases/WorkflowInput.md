---
id: WorkflowInput
title: WorkflowInput
---

# Type Alias: WorkflowInput\<TDefinition\>

```ts
type WorkflowInput<TDefinition> = TDefinition extends WorkflowDefinition<infer TInput, any, any> ? TInput : never;
```

Defined in: [packages/workflow-core/src/types.ts:446](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L446)

## Type Parameters

### TDefinition

`TDefinition`
