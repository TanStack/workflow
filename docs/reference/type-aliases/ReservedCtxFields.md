---
id: ReservedCtxFields
title: ReservedCtxFields
---

# Type Alias: ReservedCtxFields

```ts
type ReservedCtxFields = 
  | "runId"
  | "input"
  | "state"
  | "signal"
  | "runtime"
  | "step"
  | "compensate"
  | "sleep"
  | "sleepUntil"
  | "waitForEvent"
  | "approve"
  | "now"
  | "uuid"
  | "emit";
```

Defined in: [packages/workflow-core/src/types.ts:388](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L388)

Reserved field names that middleware may not override.
