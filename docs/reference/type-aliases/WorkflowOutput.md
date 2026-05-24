---
id: WorkflowOutput
title: WorkflowOutput
---

# Type Alias: WorkflowOutput\<TDefinition\>

```ts
type WorkflowOutput<TDefinition> = TDefinition extends WorkflowDefinition<any, infer TOutput, any> ? TOutput : never;
```

Defined in: [packages/workflow-core/src/types.ts:421](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L421)

## Type Parameters

### TDefinition

`TDefinition`
