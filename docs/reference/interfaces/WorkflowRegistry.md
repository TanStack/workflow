---
id: WorkflowRegistry
title: WorkflowRegistry
---

# Interface: WorkflowRegistry\<T\>

Defined in: [packages/workflow-core/src/registry/select-version.ts:64](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/registry/select-version.ts#L64)

Lightweight registry around `selectWorkflowVersion`. Same
resolution rules; same routing semantics.

    const registry = createWorkflowRegistry({ default: v2 })
    registry.add(v1)
    registry.add(v2)
    const wf = await registry.forRun(runId, store)
    runWorkflow({ workflow: wf, runId, ... })

## Type Parameters

### T

`T` *extends* [`AnyWorkflowDefinition`](../type-aliases/AnyWorkflowDefinition.md)

## Properties

### add()

```ts
add: (workflow) => void;
```

Defined in: [packages/workflow-core/src/registry/select-version.ts:67](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/registry/select-version.ts#L67)

Register a workflow definition. Duplicate (id, version) pairs
 are rejected.

#### Parameters

##### workflow

`T`

#### Returns

`void`

***

### all()

```ts
all: () => readonly T[];
```

Defined in: [packages/workflow-core/src/registry/select-version.ts:74](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/registry/select-version.ts#L74)

All registered versions.

#### Returns

readonly `T`[]

***

### forRun()

```ts
forRun: (runId, runStore) => Promise<T | undefined>;
```

Defined in: [packages/workflow-core/src/registry/select-version.ts:70](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/registry/select-version.ts#L70)

Pick the workflow version for a persisted run. Returns the
 registry's `default` if no exact match is found.

#### Parameters

##### runId

`string`

##### runStore

[`RunStore`](RunStore.md)

#### Returns

`Promise`\<`T` \| `undefined`\>

***

### get()

```ts
get: (id, version?) => T | undefined;
```

Defined in: [packages/workflow-core/src/registry/select-version.ts:72](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/registry/select-version.ts#L72)

Get a specific version by (id, version) pair.

#### Parameters

##### id

`string`

##### version?

`string`

#### Returns

`T` \| `undefined`
