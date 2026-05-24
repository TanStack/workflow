---
id: runWorkflow
title: runWorkflow
---

# Function: runWorkflow()

```ts
function runWorkflow(options): AsyncIterable<WorkflowEvent>;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:57](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L57)

Drive a workflow to completion or pause. Returns an `AsyncIterable`
of every event the engine appends to the run's log, in order.

The same events are simultaneously persisted via
`runStore.appendEvent` — the iterable and the persisted log share
one shape (the log IS the transport).

## Parameters

### options

[`RunWorkflowOptions`](../interfaces/RunWorkflowOptions.md)

## Returns

`AsyncIterable`\<[`WorkflowEvent`](../type-aliases/WorkflowEvent.md)\>
