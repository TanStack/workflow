---
id: RunState
title: RunState
---

# Interface: RunState\<TInput, TOutput\>

Defined in: [packages/workflow-core/src/types.ts:513](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L513)

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

Defined in: [packages/workflow-core/src/types.ts:525](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L525)

All currently outstanding waits. Current engine versions only
 create one awaitable at a time, but the persisted shape can
 represent future fan-out/race primitives without replacing the
 run schema.

***

### createdAt

```ts
createdAt: number;
```

Defined in: [packages/workflow-core/src/types.ts:541](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L541)

***

### error?

```ts
optional error: SerializedError;
```

Defined in: [packages/workflow-core/src/types.ts:520](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L520)

***

### input

```ts
input: TInput;
```

Defined in: [packages/workflow-core/src/types.ts:518](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L518)

***

### output?

```ts
optional output: TOutput;
```

Defined in: [packages/workflow-core/src/types.ts:519](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L519)

***

### pendingApproval?

```ts
optional pendingApproval: object;
```

Defined in: [packages/workflow-core/src/types.ts:534](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L534)

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

Defined in: [packages/workflow-core/src/types.ts:514](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L514)

***

### status

```ts
status: RunStatus;
```

Defined in: [packages/workflow-core/src/types.ts:515](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L515)

***

### updatedAt

```ts
updatedAt: number;
```

Defined in: [packages/workflow-core/src/types.ts:542](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L542)

***

### waitingFor?

```ts
optional waitingFor: object;
```

Defined in: [packages/workflow-core/src/types.ts:527](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L527)

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

Defined in: [packages/workflow-core/src/types.ts:516](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L516)

***

### workflowVersion?

```ts
optional workflowVersion: string;
```

Defined in: [packages/workflow-core/src/types.ts:517](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L517)
