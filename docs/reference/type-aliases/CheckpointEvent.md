---
id: CheckpointEvent
title: CheckpointEvent
---

# Type Alias: CheckpointEvent

```ts
type CheckpointEvent = Extract<WorkflowEvent, {
  type:   | "STEP_FINISHED"
     | "STEP_FAILED"
     | "SIGNAL_RESOLVED"
     | "APPROVAL_RESOLVED"
     | "NOW_RECORDED"
     | "UUID_RECORDED"
     | "RUN_FINISHED"
     | "RUN_ERRORED";
}>;
```

Defined in: [packages/workflow-core/src/types.ts:199](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L199)

Kinds that replay treats as completion checkpoints (engine reads
 these from the log to short-circuit primitives). All others are
 observability-only.
