---
id: WorkflowCtx
title: WorkflowCtx
---

# Type Alias: WorkflowCtx\<TExtensions\>

```ts
type WorkflowCtx<TExtensions> = Ctx<any, any, TExtensions>;
```

Defined in: [packages/workflow-core/src/types.ts:350](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L350)

Helper alias for typing functions that only care about middleware
extensions — not the calling workflow's specific input / state
shape. Common in shared utility helpers:

    async function chargeUser(
      ctx: WorkflowCtx<{ user: User }>,
      amount: number,
    ) {
      return ctx.step('charge', () => stripe.charge(amount, ctx.user.id))
    }

For helpers that need typed `ctx.input` or `ctx.state`, use the
full `Ctx<TInput, TState, TExt>` directly.

## Type Parameters

### TExtensions

`TExtensions` = `unknown`
