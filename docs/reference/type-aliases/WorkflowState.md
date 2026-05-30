---
id: WorkflowState
title: WorkflowState
---

# Type Alias: WorkflowState\<TDefinition\>

```ts
type WorkflowState<TDefinition> = TDefinition extends WorkflowDefinition<any, any, infer TState> ? TState : never;
```

Defined in: [packages/workflow-core/src/types.ts:456](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L456)

## Type Parameters

### TDefinition

`TDefinition`
