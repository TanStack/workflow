---
id: RunState
title: RunState
---

# Interface: RunState\<TInput, TOutput\>

Defined in: [packages/workflow-core/src/types.ts:462](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L462)

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

### createdAt

```ts
createdAt: number;
```

Defined in: [packages/workflow-core/src/types.ts:482](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L482)

***

### error?

```ts
optional error: SerializedError;
```

Defined in: [packages/workflow-core/src/types.ts:469](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L469)

***

### input

```ts
input: TInput;
```

Defined in: [packages/workflow-core/src/types.ts:467](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L467)

***

### output?

```ts
optional output: TOutput;
```

Defined in: [packages/workflow-core/src/types.ts:468](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L468)

***

### pendingApproval?

```ts
optional pendingApproval: object;
```

Defined in: [packages/workflow-core/src/types.ts:477](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L477)

Set when the run is paused awaiting an approval.

#### approvalId

```ts
approvalId: string;
```

#### description?

```ts
optional description: string;
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

Defined in: [packages/workflow-core/src/types.ts:463](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L463)

***

### status

```ts
status: RunStatus;
```

Defined in: [packages/workflow-core/src/types.ts:464](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L464)

***

### updatedAt

```ts
updatedAt: number;
```

Defined in: [packages/workflow-core/src/types.ts:483](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L483)

***

### waitingFor?

```ts
optional waitingFor: object;
```

Defined in: [packages/workflow-core/src/types.ts:471](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L471)

Set when the run is paused awaiting an external signal.

#### deadline?

```ts
optional deadline: number;
```

#### meta?

```ts
optional meta: Record<string, unknown>;
```

#### signalName

```ts
signalName: string;
```

***

### workflowId

```ts
workflowId: string;
```

Defined in: [packages/workflow-core/src/types.ts:465](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L465)

***

### workflowVersion?

```ts
optional workflowVersion: string;
```

Defined in: [packages/workflow-core/src/types.ts:466](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L466)
