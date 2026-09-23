---
id: SignalDelivery
title: SignalDelivery
---

# Interface: SignalDelivery\<TPayload\>

Defined in: [packages/workflow-core/src/types.ts:524](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L524)

## Type Parameters

### TPayload

`TPayload` = `unknown`

## Properties

### meta?

```ts
optional meta: WorkflowMetadata;
```

Defined in: [packages/workflow-core/src/types.ts:535](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L535)

Free-form host/UI metadata copied into SIGNAL_RESOLVED.

***

### name

```ts
name: string;
```

Defined in: [packages/workflow-core/src/types.ts:532](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L532)

Name of the awaited signal (the same name passed to
 `ctx.waitForEvent(name, ...)`).

***

### payload

```ts
payload: TPayload;
```

Defined in: [packages/workflow-core/src/types.ts:533](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L533)

***

### signalId

```ts
signalId: string;
```

Defined in: [packages/workflow-core/src/types.ts:527](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L527)

Idempotency token. Same signalId at the same stepId = no-op
 retry; different signalId = lost race.

***

### stepId?

```ts
optional stepId: string;
```

Defined in: [packages/workflow-core/src/types.ts:529](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L529)

Optional durable-operation id for the awaited signal.
