---
id: RunAwaitable
title: RunAwaitable
---

# Type Alias: RunAwaitable

```ts
type RunAwaitable = 
  | {
  deadline?: number;
  meta?: WorkflowMetadata;
  signalName: string;
  stepId?: string;
  type: "signal";
}
  | {
  approvalId: string;
  description?: string;
  meta?: WorkflowMetadata;
  stepId?: string;
  title: string;
  type: "approval";
};
```

Defined in: [packages/workflow-core/src/types.ts:490](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L490)
