---
id: CheckpointEvent
title: CheckpointEvent
---

# Type Alias: CheckpointEvent

```ts
type CheckpointEvent = Extract<WorkflowEvent, {
  type:   | "STEP_ATTEMPT_STARTED"
     | "STEP_RETRY_SCHEDULED"
     | "COMPENSATION_REGISTERED"
     | "COMPENSATION_STARTED"
     | "STEP_FINISHED"
     | "STEP_FAILED"
     | "SIGNAL_RESOLVED"
     | "APPROVAL_RESOLVED"
     | "NOW_RECORDED"
     | "UUID_RECORDED"
     | "RUN_FINISHED"
     | "RUN_ERRORED";
}>;
```

Defined in: [packages/workflow-core/src/types.ts:214](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L214)

Durable completion and recovery checkpoints used during replay.
