---
id: InMemoryRunStoreOptions
title: InMemoryRunStoreOptions
---

# Interface: InMemoryRunStoreOptions

Defined in: [packages/workflow-core/src/run-store/in-memory.ts:4](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/run-store/in-memory.ts#L4)

## Properties

### ttl?

```ts
optional ttl: number;
```

Defined in: [packages/workflow-core/src/run-store/in-memory.ts:7](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/run-store/in-memory.ts#L7)

TTL in milliseconds for finished/errored/aborted runs. Paused
 runs are exempt. Default 1 hour.
