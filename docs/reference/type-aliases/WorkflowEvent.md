---
id: WorkflowEvent
title: WorkflowEvent
---

# Type Alias: WorkflowEvent

```ts
type WorkflowEvent = 
  | {
  audience?: string;
  runId: string;
  threadId?: string;
  ts: number;
  type: "RUN_STARTED";
}
  | {
  audience?: string;
  output: unknown;
  runId: string;
  ts: number;
  type: "RUN_FINISHED";
}
  | {
  audience?: string;
  code: string;
  error: SerializedError;
  runId: string;
  ts: number;
  type: "RUN_ERRORED";
}
  | {
  audience?: string;
  meta?: WorkflowMetadata;
  stepId: string;
  ts: number;
  type: "STEP_STARTED";
}
  | {
  attempts?: ReadonlyArray<StepAttempt>;
  audience?: string;
  meta?: WorkflowMetadata;
  result: unknown;
  stepId: string;
  ts: number;
  type: "STEP_FINISHED";
}
  | {
  attempts?: ReadonlyArray<StepAttempt>;
  audience?: string;
  error: SerializedError;
  meta?: WorkflowMetadata;
  stepId: string;
  ts: number;
  type: "STEP_FAILED";
}
  | {
  audience?: string;
  deadline?: number;
  meta?: Record<string, unknown>;
  name: string;
  stepId: string;
  ts: number;
  type: "SIGNAL_AWAITED";
}
  | {
  audience?: string;
  meta?: WorkflowMetadata;
  name: string;
  payload: unknown;
  signalId?: string;
  stepId: string;
  ts: number;
  type: "SIGNAL_RESOLVED";
}
  | {
  approvalId: string;
  audience?: string;
  description?: string;
  meta?: WorkflowMetadata;
  stepId: string;
  title: string;
  ts: number;
  type: "APPROVAL_REQUESTED";
}
  | {
  approvalId: string;
  approved: boolean;
  audience?: string;
  feedback?: string;
  meta?: WorkflowMetadata;
  stepId: string;
  ts: number;
  type: "APPROVAL_RESOLVED";
}
  | {
  audience?: string;
  meta?: WorkflowMetadata;
  stepId: string;
  ts: number;
  type: "NOW_RECORDED";
  value: number;
}
  | {
  audience?: string;
  meta?: WorkflowMetadata;
  stepId: string;
  ts: number;
  type: "UUID_RECORDED";
  value: string;
}
  | {
  audience?: string;
  delta: ReadonlyArray<Operation>;
  ts: number;
  type: "STATE_DELTA";
}
  | {
  audience?: string;
  name: string;
  ts: number;
  type: "CUSTOM";
  value: Record<string, unknown>;
};
```

Defined in: [packages/workflow-core/src/types.ts:70](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L70)

The shape of every event the engine appends to a run's log.

Two consumers, one shape:

  - **Durability**: the engine appends events to the run's log.
    Replay reads the log and short-circuits primitives that have
    a matching CHECKPOINT event by `stepId`.
  - **Observability**: the engine emits the same events through
    `runWorkflow`'s `AsyncIterable<WorkflowEvent>` and (if wired)
    through stream subscribers. A browser/UI subscribes to the
    same log a Durable Streams URL would expose.

Events fall into two categories internally:

  - **Checkpoint events** — replay uses these to skip already-
    completed work. Indexed by `stepId`. STEP_FINISHED,
    STEP_FAILED, SIGNAL_RESOLVED, APPROVAL_RESOLVED, NOW_RECORDED,
    UUID_RECORDED, RUN_FINISHED, RUN_ERRORED.

  - **Coordination events** — persisted so hosts and resume calls
    can identify the pending wait. SIGNAL_AWAITED,
    APPROVAL_REQUESTED.

  - **Observability events** — engine emits but replay ignores.
    RUN_STARTED, STEP_STARTED, STATE_DELTA, CUSTOM.

The optional `audience` field is engine-ignored. Adapters/views
(e.g., a Durable Streams projection layer) may filter on it to
produce internal vs client vs admin views of the same log.

## Type Declaration

```ts
{
  audience?: string;
  runId: string;
  threadId?: string;
  ts: number;
  type: "RUN_STARTED";
}
```

### audience?

```ts
optional audience: string;
```

### runId

```ts
runId: string;
```

### threadId?

```ts
optional threadId: string;
```

### ts

```ts
ts: number;
```

### type

```ts
type: "RUN_STARTED";
```

```ts
{
  audience?: string;
  output: unknown;
  runId: string;
  ts: number;
  type: "RUN_FINISHED";
}
```

### audience?

```ts
optional audience: string;
```

### output

```ts
output: unknown;
```

### runId

```ts
runId: string;
```

### ts

```ts
ts: number;
```

### type

```ts
type: "RUN_FINISHED";
```

```ts
{
  audience?: string;
  code: string;
  error: SerializedError;
  runId: string;
  ts: number;
  type: "RUN_ERRORED";
}
```

### audience?

```ts
optional audience: string;
```

### code

```ts
code: string;
```

### error

```ts
error: SerializedError;
```

### runId

```ts
runId: string;
```

### ts

```ts
ts: number;
```

### type

```ts
type: "RUN_ERRORED";
```

```ts
{
  audience?: string;
  meta?: WorkflowMetadata;
  stepId: string;
  ts: number;
  type: "STEP_STARTED";
}
```

### audience?

```ts
optional audience: string;
```

### meta?

```ts
optional meta: WorkflowMetadata;
```

### stepId

```ts
stepId: string;
```

### ts

```ts
ts: number;
```

### type

```ts
type: "STEP_STARTED";
```

```ts
{
  attempts?: ReadonlyArray<StepAttempt>;
  audience?: string;
  meta?: WorkflowMetadata;
  result: unknown;
  stepId: string;
  ts: number;
  type: "STEP_FINISHED";
}
```

### attempts?

```ts
optional attempts: ReadonlyArray<StepAttempt>;
```

### audience?

```ts
optional audience: string;
```

### meta?

```ts
optional meta: WorkflowMetadata;
```

### result

```ts
result: unknown;
```

### stepId

```ts
stepId: string;
```

### ts

```ts
ts: number;
```

### type

```ts
type: "STEP_FINISHED";
```

```ts
{
  attempts?: ReadonlyArray<StepAttempt>;
  audience?: string;
  error: SerializedError;
  meta?: WorkflowMetadata;
  stepId: string;
  ts: number;
  type: "STEP_FAILED";
}
```

### attempts?

```ts
optional attempts: ReadonlyArray<StepAttempt>;
```

### audience?

```ts
optional audience: string;
```

### error

```ts
error: SerializedError;
```

### meta?

```ts
optional meta: WorkflowMetadata;
```

### stepId

```ts
stepId: string;
```

### ts

```ts
ts: number;
```

### type

```ts
type: "STEP_FAILED";
```

```ts
{
  audience?: string;
  deadline?: number;
  meta?: Record<string, unknown>;
  name: string;
  stepId: string;
  ts: number;
  type: "SIGNAL_AWAITED";
}
```

### audience?

```ts
optional audience: string;
```

### deadline?

```ts
optional deadline: number;
```

### meta?

```ts
optional meta: Record<string, unknown>;
```

### name

```ts
name: string;
```

### stepId

```ts
stepId: string;
```

### ts

```ts
ts: number;
```

### type

```ts
type: "SIGNAL_AWAITED";
```

```ts
{
  audience?: string;
  meta?: WorkflowMetadata;
  name: string;
  payload: unknown;
  signalId?: string;
  stepId: string;
  ts: number;
  type: "SIGNAL_RESOLVED";
}
```

### audience?

```ts
optional audience: string;
```

### meta?

```ts
optional meta: WorkflowMetadata;
```

### name

```ts
name: string;
```

### payload

```ts
payload: unknown;
```

### signalId?

```ts
optional signalId: string;
```

Host-supplied idempotency token. Same `signalId` at the
 same `stepId` is a no-op (idempotent retry); different
 `signalId` is a lost race.

### stepId

```ts
stepId: string;
```

### ts

```ts
ts: number;
```

### type

```ts
type: "SIGNAL_RESOLVED";
```

```ts
{
  approvalId: string;
  audience?: string;
  description?: string;
  meta?: WorkflowMetadata;
  stepId: string;
  title: string;
  ts: number;
  type: "APPROVAL_REQUESTED";
}
```

### approvalId

```ts
approvalId: string;
```

### audience?

```ts
optional audience: string;
```

### description?

```ts
optional description: string;
```

### meta?

```ts
optional meta: WorkflowMetadata;
```

### stepId

```ts
stepId: string;
```

### title

```ts
title: string;
```

### ts

```ts
ts: number;
```

### type

```ts
type: "APPROVAL_REQUESTED";
```

```ts
{
  approvalId: string;
  approved: boolean;
  audience?: string;
  feedback?: string;
  meta?: WorkflowMetadata;
  stepId: string;
  ts: number;
  type: "APPROVAL_RESOLVED";
}
```

### approvalId

```ts
approvalId: string;
```

### approved

```ts
approved: boolean;
```

### audience?

```ts
optional audience: string;
```

### feedback?

```ts
optional feedback: string;
```

### meta?

```ts
optional meta: WorkflowMetadata;
```

### stepId

```ts
stepId: string;
```

### ts

```ts
ts: number;
```

### type

```ts
type: "APPROVAL_RESOLVED";
```

```ts
{
  audience?: string;
  meta?: WorkflowMetadata;
  stepId: string;
  ts: number;
  type: "NOW_RECORDED";
  value: number;
}
```

### audience?

```ts
optional audience: string;
```

### meta?

```ts
optional meta: WorkflowMetadata;
```

### stepId

```ts
stepId: string;
```

### ts

```ts
ts: number;
```

### type

```ts
type: "NOW_RECORDED";
```

### value

```ts
value: number;
```

```ts
{
  audience?: string;
  meta?: WorkflowMetadata;
  stepId: string;
  ts: number;
  type: "UUID_RECORDED";
  value: string;
}
```

### audience?

```ts
optional audience: string;
```

### meta?

```ts
optional meta: WorkflowMetadata;
```

### stepId

```ts
stepId: string;
```

### ts

```ts
ts: number;
```

### type

```ts
type: "UUID_RECORDED";
```

### value

```ts
value: string;
```

```ts
{
  audience?: string;
  delta: ReadonlyArray<Operation>;
  ts: number;
  type: "STATE_DELTA";
}
```

### audience?

```ts
optional audience: string;
```

### delta

```ts
delta: ReadonlyArray<Operation>;
```

### ts

```ts
ts: number;
```

### type

```ts
type: "STATE_DELTA";
```

```ts
{
  audience?: string;
  name: string;
  ts: number;
  type: "CUSTOM";
  value: Record<string, unknown>;
}
```

### audience?

```ts
optional audience: string;
```

### name

```ts
name: string;
```

### ts

```ts
ts: number;
```

### type

```ts
type: "CUSTOM";
```

### value

```ts
value: Record<string, unknown>;
```
