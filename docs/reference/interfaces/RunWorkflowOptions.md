---
id: RunWorkflowOptions
title: RunWorkflowOptions
---

# Interface: RunWorkflowOptions

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:34](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L34)

## Properties

### approval?

```ts
optional approval: ApprovalResult;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:43](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L43)

***

### attach?

```ts
optional attach: boolean;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:48](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L48)

Read-only subscription to an existing run.

***

### deadline?

```ts
optional deadline: number;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:65](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L65)

Absolute UTC ms deadline for this runtime drive. Workflow automatically
 yields before fresh durable work when the remaining budget is too low.

***

### input?

```ts
optional input: unknown;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:40](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L40)

Start: provide `input`. Resume: provide `runId` plus a delivery
 (`signalDelivery` or `approval`). Recover: `runId` + `recover: true`.
 Attach: `runId` + `attach: true`.

***

### minYieldRemainingMs?

```ts
optional minYieldRemainingMs: number;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:68](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L68)

Minimum budget that must remain before starting fresh durable work.
 Defaults to 1000ms when `deadline` is set.

***

### outputSink()?

```ts
optional outputSink: (output) => void;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:59](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L59)

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

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:56](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L56)

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

### recover?

```ts
optional recover: boolean;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:46](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L46)

Replay an interrupted running execution from durable checkpoints.
 Host runtimes use this after reclaiming an expired run lease.

***

### runId?

```ts
optional runId: string;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:41](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L41)

***

### runStore

```ts
runStore: RunStore;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:36](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L36)

***

### signal?

```ts
optional signal: AbortSignal;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:50](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L50)

External cancellation.

***

### signalDelivery?

```ts
optional signalDelivery: SignalDelivery<unknown>;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:42](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L42)

***

### telemetry?

```ts
optional telemetry: false | WorkflowTelemetryOptions;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:62](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L62)

OpenTelemetry tracing configuration. Uses the global tracer provider
 by default and records no payloads/results as attributes.

***

### threadId?

```ts
optional threadId: string;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:52](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L52)

Thread ID for client-side correlation.

***

### workflow

```ts
workflow: AnyWorkflowDefinition;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:35](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L35)

***

### yieldResumeAt?

```ts
optional yieldResumeAt: number;
```

Defined in: [packages/workflow-core/src/engine/run-workflow.ts:71](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/engine/run-workflow.ts#L71)

UTC ms wake time used for cooperative yields. Runtime sets this past the
 current sweep timestamp so yielded runs continue on a later sweep.
