---
id: DurableOperationOptions
title: DurableOperationOptions
---

# Interface: DurableOperationOptions

Defined in: [packages/workflow-core/src/types.ts:24](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L24)

## Extended by

- [`ApproveOptions`](ApproveOptions.md)
- [`DeterministicValueOptions`](DeterministicValueOptions.md)
- [`SleepOptions`](SleepOptions.md)
- [`WaitForEventOptions`](WaitForEventOptions.md)

## Properties

### id?

```ts
optional id: string;
```

Defined in: [packages/workflow-core/src/types.ts:30](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L30)

Stable durable-operation identifier. Supplying this lets replay
find the right log record even if surrounding operations are
reordered in a later workflow version.

***

### meta?

```ts
optional meta: WorkflowMetadata;
```

Defined in: [packages/workflow-core/src/types.ts:32](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L32)

Free-form host/UI metadata copied into the operation's log event.
