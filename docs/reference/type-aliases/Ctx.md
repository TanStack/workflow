---
id: Ctx
title: Ctx
---

# Type Alias: Ctx\<TInput, TState, TExtensions\>

```ts
type Ctx<TInput, TState, TExtensions> = BaseCtx<TInput, TState> & TExtensions;
```

Defined in: [packages/workflow-core/src/types.ts:329](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L329)

Full ctx type passed to a handler, including middleware-added
 fields. `TExtensions` defaults to `unknown` so the empty-middleware
 case collapses cleanly under intersection
 (`unknown & BaseCtx === BaseCtx`).

## Type Parameters

### TInput

`TInput` = `unknown`

### TState

`TState` = `Record`\<`string`, `unknown`\>

### TExtensions

`TExtensions` = `unknown`
