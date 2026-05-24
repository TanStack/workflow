---
id: RunWorkflowOptions
title: RunWorkflowOptions
---

# Interface: RunWorkflowOptions

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:25](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L25)

## Properties

### approval?

```ts
optional approval: ApprovalResult;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:33](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L33)

***

### attach?

```ts
optional attach: boolean;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:35](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L35)

Read-only subscription to an existing run.

***

### input?

```ts
optional input: unknown;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:30](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L30)

Start: provide `input`. Resume: provide `runId` plus a delivery
 (`signalDelivery` or `approval`). Attach: `runId` + `attach: true`.

***

### outputSink()?

```ts
optional outputSink: (output) => void;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:46](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L46)

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

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:43](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L43)

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

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:31](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L31)

***

### runStore

```ts
runStore: RunStore;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:27](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L27)

***

### signal?

```ts
optional signal: AbortSignal;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:37](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L37)

External cancellation.

***

### signalDelivery?

```ts
optional signalDelivery: SignalDelivery<unknown>;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:32](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L32)

***

### threadId?

```ts
optional threadId: string;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:39](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L39)

Thread ID for client-side correlation.

***

### workflow

```ts
workflow: AnyWorkflowDefinition;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:26](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L26)
