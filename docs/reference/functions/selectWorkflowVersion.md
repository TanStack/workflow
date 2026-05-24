---
id: selectWorkflowVersion
title: selectWorkflowVersion
---

# Function: selectWorkflowVersion()

```ts
function selectWorkflowVersion<T>(
   versions, 
   runId, 
runStore): Promise<T | undefined>;
```

Defined in: [packages/workflow-core/src/registry/select-version.ts:28](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/registry/select-version.ts#L28)

Pick the workflow version that a persisted run was started under.

Hosts running multiple versions of the same workflow side-by-side
use this to route resume calls to the right code path. Each
`WorkflowDefinition` should carry a `version` field
(`createWorkflow({ version: 'v1', ... })`); the helper compares
that against the `workflowVersion` field on the run's persisted
state.

Resolution order:
  1. Exact match by `workflowId` AND `workflowVersion`.
  2. If no `workflowVersion` is persisted (e.g., older runs from
     before the version field existed), fall back to the FIRST
     definition whose `id` matches and which does NOT declare
     `version` (the "unversioned default").
  3. Otherwise undefined — the host decides whether to reject or
     use a latest-version fallback.

    const v1 = createWorkflow({ id: 'pipeline', version: 'v1' }).handler(...)
    const v2 = createWorkflow({ id: 'pipeline', version: 'v2' }).handler(...)
    const wf = await selectWorkflowVersion([v1, v2], runId, store)
                 ?? v2 // default to latest for fresh starts / unrouted runs
    runWorkflow({ workflow: wf, runId, ... })

## Type Parameters

### T

`T` *extends* [`AnyWorkflowDefinition`](../type-aliases/AnyWorkflowDefinition.md)

## Parameters

### versions

readonly `T`[]

### runId

`string`

### runStore

[`RunStore`](../interfaces/RunStore.md)

## Returns

`Promise`\<`T` \| `undefined`\>
