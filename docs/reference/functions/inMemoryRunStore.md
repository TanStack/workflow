---
id: inMemoryRunStore
title: inMemoryRunStore
---

# Function: inMemoryRunStore()

```ts
function inMemoryRunStore(options): RunStore;
```

Defined in: [packages/workflow-core/src/run-store/in-memory.ts:17](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/run-store/in-memory.ts#L17)

In-memory backing store. Holds per-run state + append-only event
log + optional push subscribers. Suitable for single-process
prototypes and the test suite.

## Parameters

### options

[`InMemoryRunStoreOptions`](../interfaces/InMemoryRunStoreOptions.md) = `{}`

## Returns

[`RunStore`](../interfaces/RunStore.md)
