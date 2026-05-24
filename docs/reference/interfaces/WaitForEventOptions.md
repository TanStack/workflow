---
id: WaitForEventOptions
title: WaitForEventOptions
---

# Interface: WaitForEventOptions\<TPayload\>

Defined in: [packages/workflow-core/src/types.ts:243](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L243)

## Type Parameters

### TPayload

`TPayload` = `unknown`

## Properties

### deadline?

```ts
optional deadline: number;
```

Defined in: [packages/workflow-core/src/types.ts:246](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L246)

UTC ms wake deadline. Surfaced on `RunState.waitingFor.deadline`
 so hosts can build time-indexed worker jobs.

***

### meta?

```ts
optional meta: Record<string, unknown>;
```

Defined in: [packages/workflow-core/src/types.ts:248](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L248)

Free-form metadata the host or UI may render.

***

### schema?

```ts
optional schema: StandardSchemaV1<unknown, TPayload>;
```

Defined in: [packages/workflow-core/src/types.ts:251](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L251)

Optional schema for validating the incoming payload before
 resuming the workflow.
