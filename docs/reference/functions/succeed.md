---
id: succeed
title: succeed
---

# Function: succeed()

```ts
function succeed<T>(data): object & T;
```

Defined in: [packages/workflow-core/src/result.ts:9](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/result.ts#L9)

Tagged result helpers for workflows that return discriminated success/failure
unions. Avoids `as const` casts at every return site.

    return succeed({ output: final })        // { ok: true; output: Draft }
    return fail(`validation: ${reason}`)     // { ok: false; reason: string }

## Type Parameters

### T

`T` *extends* `Record`\<`string`, `unknown`\>

## Parameters

### data

`T`

## Returns

`object` & `T`
