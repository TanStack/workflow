---
id: WaitForEventOptions
title: WaitForEventOptions
---

# Interface: WaitForEventOptions\<TPayload\>

Defined in: [packages/workflow-core/src/types.ts:266](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L266)

## Extends

- [`DurableOperationOptions`](DurableOperationOptions.md)

## Type Parameters

### TPayload

`TPayload` = `unknown`

## Properties

### deadline?

```ts
optional deadline: number;
```

Defined in: [packages/workflow-core/src/types.ts:271](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L271)

UTC ms wake deadline. Surfaced on `RunState.waitingFor.deadline`
 so hosts can build time-indexed worker jobs.

***

### id?

```ts
optional id: string;
```

Defined in: [packages/workflow-core/src/types.ts:30](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L30)

Stable durable-operation identifier. Supplying this lets replay
find the right log record even if surrounding operations are
reordered in a later workflow version.

#### Inherited from

[`DurableOperationOptions`](DurableOperationOptions.md).[`id`](DurableOperationOptions.md#id)

***

### meta?

```ts
optional meta: WorkflowMetadata;
```

Defined in: [packages/workflow-core/src/types.ts:273](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L273)

Free-form metadata the host or UI may render.

#### Overrides

[`DurableOperationOptions`](DurableOperationOptions.md).[`meta`](DurableOperationOptions.md#meta)

***

### schema?

```ts
optional schema: StandardSchemaV1<unknown, TPayload>;
```

Defined in: [packages/workflow-core/src/types.ts:276](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L276)

Optional schema for validating the incoming payload before
 resuming the workflow.
