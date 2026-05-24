---
id: createWorkflow
title: createWorkflow
---

# Function: createWorkflow()

```ts
function createWorkflow<TInputSchema, TOutputSchema, TStateSchema>(config): WorkflowBuilder<TInputSchema, TOutputSchema, TStateSchema>;
```

Defined in: [packages/workflow-core/src/define/define-workflow.ts:198](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L198)

Define a workflow. Returns a builder chain:

    export const onboard = createWorkflow({
      id: 'onboard',
      input: z.object({ userId: z.string() }),
    })
      .middleware([requireUser, traced])
      .handler(async (ctx) => {
        const profile = await ctx.step('load', () => loadProfile(ctx.user.id))
        await ctx.sleep(60_000)
        const decision = await ctx.approve({ title: 'Continue?' })
        return { ok: decision.approved }
      })

The handler's `ctx` argument carries everything: input, state,
durable primitives (`step`, `sleep`, `waitForEvent`, ...), and
any fields added by registered middleware. Helpers should accept
a typed `Ctx<...>` argument to compose cleanly.

## Type Parameters

### TInputSchema

`TInputSchema` *extends* [`SchemaInput`](../type-aliases/SchemaInput.md) \| `undefined` = `undefined`

### TOutputSchema

`TOutputSchema` *extends* [`SchemaInput`](../type-aliases/SchemaInput.md) \| `undefined` = `undefined`

### TStateSchema

`TStateSchema` *extends* [`SchemaInput`](../type-aliases/SchemaInput.md) \| `undefined` = `undefined`

## Parameters

### config

[`CreateWorkflowConfig`](../interfaces/CreateWorkflowConfig.md)\<`TInputSchema`, `TOutputSchema`, `TStateSchema`\>

## Returns

[`WorkflowBuilder`](../interfaces/WorkflowBuilder.md)\<`TInputSchema`, `TOutputSchema`, `TStateSchema`\>
