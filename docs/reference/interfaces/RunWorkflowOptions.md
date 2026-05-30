---
id: RunWorkflowOptions
title: RunWorkflowOptions
---

# Interface: RunWorkflowOptions

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:27](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L27)

## Properties

### approval?

```ts
optional approval: ApprovalResult;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:35](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L35)

***

### attach?

```ts
optional attach: boolean;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:37](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L37)

Read-only subscription to an existing run.

***

### input?

```ts
optional input: unknown;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:32](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L32)

Start: provide `input`. Resume: provide `runId` plus a delivery
 (`signalDelivery` or `approval`). Attach: `runId` + `attach: true`.

***

### outputSink()?

```ts
optional outputSink: (output) => void;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:48](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L48)

Called with the workflow's final output before the run record is
 cleaned up.

#### Parameters

##### output

`unknown`

#### Returns

`void`

***

### publish()?

```ts
optional publish: (runId, event) => void | Promise<void>;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:45](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L45)

Hook called for every event the engine appends. Hosts wire this
 to a fan-out transport (Redis, Durable Streams, EventBridge) so
 subscribers on other nodes can tail the run.

#### Parameters

##### runId

`string`

##### event

[`WorkflowEvent`](../type-aliases/WorkflowEvent.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### runId?

```ts
optional runId: string;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:33](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L33)

***

### runStore

```ts
runStore: RunStore;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:29](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L29)

***

### signal?

```ts
optional signal: AbortSignal;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:39](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L39)

External cancellation.

***

### signalDelivery?

```ts
optional signalDelivery: SignalDelivery<unknown>;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:34](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L34)

***

### threadId?

```ts
optional threadId: string;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:41](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L41)

Thread ID for client-side correlation.

***

### workflow

```ts
workflow: AnyWorkflowDefinition;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:28](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L28)
