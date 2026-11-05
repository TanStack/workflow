---
id: SignalDelivery
title: SignalDelivery
---

# Interface: SignalDelivery\<TPayload\>

Defined in: [packages/workflow-core/src/types.ts:465](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L465)

## Type Parameters

### TPayload

`TPayload` = `unknown`

## Properties

### meta?

```ts
optional meta: WorkflowMetadata;
```

Defined in: [packages/workflow-core/src/types.ts:476](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L476)

Free-form host/UI metadata copied into SIGNAL_RESOLVED.

***

### name

```ts
name: string;
```

Defined in: [packages/workflow-core/src/types.ts:473](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L473)

Name of the awaited signal (the same name passed to
 `ctx.waitForEvent(name, ...)`).

***

### payload

```ts
payload: TPayload;
```

Defined in: [packages/workflow-core/src/types.ts:474](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L474)

***

### signalId

```ts
signalId: string;
```

Defined in: [packages/workflow-core/src/types.ts:468](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L468)

Idempotency token. Same signalId at the same stepId = no-op
 retry; different signalId = lost race.

***

### stepId?

```ts
optional stepId: string;
```

Defined in: [packages/workflow-core/src/types.ts:470](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L470)

Optional durable-operation id for the awaited signal.
