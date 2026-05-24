---
id: WorkflowBuilder
title: WorkflowBuilder
---

# Interface: WorkflowBuilder\<TInputSchema, TOutputSchema, TStateSchema, TCtxExt\>

Defined in: [packages/workflow-core/src/define/define-workflow.ts:84](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L84)

## Type Parameters

### TInputSchema

`TInputSchema` *extends* [`SchemaInput`](../type-aliases/SchemaInput.md) \| `undefined`

### TOutputSchema

`TOutputSchema` *extends* [`SchemaInput`](../type-aliases/SchemaInput.md) \| `undefined`

### TStateSchema

`TStateSchema` *extends* [`SchemaInput`](../type-aliases/SchemaInput.md) \| `undefined`

### TCtxExt

`TCtxExt` = `unknown`

## Properties

### handler()

```ts
handler: <TActualOutput>(fn) => WorkflowDefinition<InferInput<TInputSchema>, TActualOutput, InferState<TStateSchema>>;
```

Defined in: [packages/workflow-core/src/define/define-workflow.ts:124](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L124)

Finalize the workflow with its handler. The handler receives the
fully-typed ctx — input, state, durable primitives, plus every
field added by registered middleware.

The handler's *actual* return type narrows the workflow's
`TOutput`: writing `return { orderId, reference }` makes the
workflow definition carry that exact shape, no annotation needed.
When `output: z.object(...)` is declared, the return type is
constrained by the schema but the narrower inferred type wins for
consumers of `WorkflowOutput<typeof wf>`.

#### Type Parameters

##### TActualOutput

`TActualOutput` *extends* `unknown`

#### Parameters

##### fn

(`ctx`) => `Promise`\<`TActualOutput`\>

#### Returns

[`WorkflowDefinition`](WorkflowDefinition.md)\<`InferInput`\<`TInputSchema`\>, `TActualOutput`, `InferState`\<`TStateSchema`\>\>

***

### middleware()

```ts
middleware: <TMiddlewares>(middlewares) => WorkflowBuilder<TInputSchema, TOutputSchema, TStateSchema, TCtxExt & UnionToIntersection<TMiddlewares[number] extends Middleware<any, TExtension> ? TExtension : never>>;
```

Defined in: [packages/workflow-core/src/define/define-workflow.ts:94](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L94)

Register middlewares that extend the ctx for the handler. Each
middleware's added fields are intersected into the ctx type.

#### Type Parameters

##### TMiddlewares

`TMiddlewares` *extends* readonly [`AnyMiddleware`](../type-aliases/AnyMiddleware.md)[]

#### Parameters

##### middlewares

`TMiddlewares`

#### Returns

`WorkflowBuilder`\<`TInputSchema`, `TOutputSchema`, `TStateSchema`, `TCtxExt` & `UnionToIntersection`\<`TMiddlewares`\[`number`\] *extends* [`Middleware`](Middleware.md)\<`any`, `TExtension`\> ? `TExtension` : `never`\>\>

***

### previousVersions()

```ts
previousVersions: (versions) => WorkflowBuilder<TInputSchema, TOutputSchema, TStateSchema, TCtxExt>;
```

Defined in: [packages/workflow-core/src/define/define-workflow.ts:108](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L108)

Register prior workflow versions that may still have in-flight
runs. Resume calls for a run started under one of these versions
route to that version's handler.

#### Parameters

##### versions

readonly [`AnyWorkflowDefinition`](../type-aliases/AnyWorkflowDefinition.md)[]

#### Returns

`WorkflowBuilder`\<`TInputSchema`, `TOutputSchema`, `TStateSchema`, `TCtxExt`\>
