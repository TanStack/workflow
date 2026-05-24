---
id: RunStore
title: RunStore
---

# Interface: RunStore

Defined in: [packages/workflow-core/src/types.ts:513](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L513)

Pluggable backing store for workflow runs.

Two surfaces:

  - **State** (`getRunState` / `setRunState` / `deleteRun`) —
    low-frequency metadata writes (status, output, pause info).
    State the user mutates inside the handler is NOT persisted
    here; it's reconstructed from log replay.

  - **Event log** (`appendEvent` / `getEvents`) — append-only
    with optimistic CAS on `expectedNextIndex`. Each entry is a
    `WorkflowEvent`. Used for both replay (engine reads
    checkpoint events back) and transport (UI subscribers tail
    the log).

Stores that support push-based subscription (in-memory, Redis
pub/sub, Postgres LISTEN/NOTIFY, Durable Streams) should
implement `subscribe` so callers can tail a run live without
polling.

## Properties

### appendEvent()

```ts
appendEvent: (runId, expectedNextIndex, event) => Promise<void>;
```

Defined in: [packages/workflow-core/src/types.ts:523](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L523)

Append `event` at `expectedNextIndex`. Throws `LogConflictError`
 if another writer has already committed at that index. Must be
 atomic.

#### Parameters

##### runId

`string`

##### expectedNextIndex

`number`

##### event

[`WorkflowEvent`](../type-aliases/WorkflowEvent.md)

#### Returns

`Promise`\<`void`\>

***

### deleteRun()

```ts
deleteRun: (runId, reason) => Promise<void>;
```

Defined in: [packages/workflow-core/src/types.ts:517](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L517)

#### Parameters

##### runId

`string`

##### reason

[`DeleteReason`](../type-aliases/DeleteReason.md)

#### Returns

`Promise`\<`void`\>

***

### getEvents()

```ts
getEvents: (runId) => Promise<readonly WorkflowEvent[]>;
```

Defined in: [packages/workflow-core/src/types.ts:529](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L529)

Read every event for `runId`, ordered by append position.

#### Parameters

##### runId

`string`

#### Returns

`Promise`\<readonly [`WorkflowEvent`](../type-aliases/WorkflowEvent.md)[]\>

***

### getRunState()

```ts
getRunState: (runId) => Promise<RunState<unknown, unknown> | undefined>;
```

Defined in: [packages/workflow-core/src/types.ts:515](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L515)

#### Parameters

##### runId

`string`

#### Returns

`Promise`\<[`RunState`](RunState.md)\<`unknown`, `unknown`\> \| `undefined`\>

***

### setRunState()

```ts
setRunState: (runId, state) => Promise<void>;
```

Defined in: [packages/workflow-core/src/types.ts:516](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L516)

#### Parameters

##### runId

`string`

##### state

[`RunState`](RunState.md)

#### Returns

`Promise`\<`void`\>

***

### subscribe()?

```ts
optional subscribe: (runId, fromIndex, onEvent) => () => void;
```

Defined in: [packages/workflow-core/src/types.ts:535](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L535)

Subscribe to new events for `runId`. Returns an unsubscribe
 function. Stores without push support omit this and callers
 fall back to polling `getEvents`.

#### Parameters

##### runId

`string`

##### fromIndex

`number`

##### onEvent

(`event`, `index`) => `void`

#### Returns

```ts
(): void;
```

##### Returns

`void`
