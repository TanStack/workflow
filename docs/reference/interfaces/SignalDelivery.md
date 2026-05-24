---
id: SignalDelivery
title: SignalDelivery
---

# Interface: SignalDelivery\<TPayload\>

Defined in: [packages/workflow-core/src/types.ts:435](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L435)

## Type Parameters

### TPayload

`TPayload` = `unknown`

## Properties

### name

```ts
name: string;
```

Defined in: [packages/workflow-core/src/types.ts:441](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L441)

Name of the awaited signal (the same name passed to
 `ctx.waitForEvent(name, ...)`).

***

### payload

```ts
payload: TPayload;
```

Defined in: [packages/workflow-core/src/types.ts:442](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L442)

***

### signalId

```ts
signalId: string;
```

Defined in: [packages/workflow-core/src/types.ts:438](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L438)

Idempotency token. Same signalId at the same stepId = no-op
 retry; different signalId = lost race.
