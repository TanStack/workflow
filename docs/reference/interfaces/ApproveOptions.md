---
id: ApproveOptions
title: ApproveOptions
---

# Interface: ApproveOptions

Defined in: [packages/workflow-core/src/types.ts:283](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L283)

## Extends

- [`DurableOperationOptions`](DurableOperationOptions.md)

## Properties

### description?

```ts
optional description: string;
```

Defined in: [packages/workflow-core/src/types.ts:285](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L285)

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

Defined in: [packages/workflow-core/src/types.ts:32](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L32)

Free-form host/UI metadata copied into the operation's log event.

#### Inherited from

[`DurableOperationOptions`](DurableOperationOptions.md).[`meta`](DurableOperationOptions.md#meta)

***

### title

```ts
title: string;
```

Defined in: [packages/workflow-core/src/types.ts:284](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L284)
