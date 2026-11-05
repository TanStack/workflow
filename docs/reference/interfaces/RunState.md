---
id: RunState
title: RunState
---

# Interface: RunState\<TInput, TOutput\>

Defined in: [packages/workflow-core/src/types.ts:572](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L572)

Persisted run metadata. State is intentionally NOT stored here —
it is reconstructed from `initialize(input)` + log replay on every
resume. The store only persists what's needed to route, resume,
and audit a run.

## Type Parameters

### TInput

`TInput` = `unknown`

### TOutput

`TOutput` = `unknown`

## Properties

### awaiting?

```ts
optional awaiting: readonly RunAwaitable[];
```

Defined in: [packages/workflow-core/src/types.ts:584](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L584)

All currently outstanding waits. Current engine versions only
 create one awaitable at a time, but the persisted shape can
 represent future fan-out/race primitives without replacing the
 run schema.

***

### createdAt

```ts
createdAt: number;
```

Defined in: [packages/workflow-core/src/types.ts:600](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L600)

***

### error?

```ts
optional error: SerializedError;
```

Defined in: [packages/workflow-core/src/types.ts:579](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L579)

***

### input

```ts
input: TInput;
```

Defined in: [packages/workflow-core/src/types.ts:577](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L577)

***

### output?

```ts
optional output: TOutput;
```

Defined in: [packages/workflow-core/src/types.ts:578](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L578)

***

### pendingApproval?

```ts
optional pendingApproval: object;
```

Defined in: [packages/workflow-core/src/types.ts:593](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L593)

Set when the run is paused awaiting an approval.

#### approvalId

```ts
approvalId: string;
```

#### description?

```ts
optional description: string;
```

#### meta?

```ts
optional meta: WorkflowMetadata;
```

#### stepId?

```ts
optional stepId: string;
```

#### title

```ts
title: string;
```

***

### runId

```ts
runId: string;
```

Defined in: [packages/workflow-core/src/types.ts:573](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L573)

***

### status

```ts
status: RunStatus;
```

Defined in: [packages/workflow-core/src/types.ts:574](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L574)

***

### updatedAt

```ts
updatedAt: number;
```

Defined in: [packages/workflow-core/src/types.ts:601](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L601)

***

### waitingFor?

```ts
optional waitingFor: object;
```

Defined in: [packages/workflow-core/src/types.ts:586](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L586)

Set when the run is paused awaiting an external signal.

#### deadline?

```ts
optional deadline: number;
```

#### meta?

```ts
optional meta: WorkflowMetadata;
```

#### signalName

```ts
signalName: string;
```

#### stepId?

```ts
optional stepId: string;
```

***

### workflowId

```ts
workflowId: string;
```

Defined in: [packages/workflow-core/src/types.ts:575](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L575)

***

### workflowVersion?

```ts
optional workflowVersion: string;
```

Defined in: [packages/workflow-core/src/types.ts:576](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L576)
