---
id: CreateWorkflowConfig
title: CreateWorkflowConfig
---

# Interface: CreateWorkflowConfig\<TInputSchema, TOutputSchema, TStateSchema\>

Defined in: [packages/workflow-core/src/define/define-workflow.ts:43](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L43)

## Type Parameters

### TInputSchema

`TInputSchema` *extends* [`SchemaInput`](../type-aliases/SchemaInput.md) \| `undefined`

### TOutputSchema

`TOutputSchema` *extends* [`SchemaInput`](../type-aliases/SchemaInput.md) \| `undefined`

### TStateSchema

`TStateSchema` *extends* [`SchemaInput`](../type-aliases/SchemaInput.md) \| `undefined`

## Properties

### defaultStepRetry?

```ts
optional defaultStepRetry: StepRetryOptions;
```

Defined in: [packages/workflow-core/src/define/define-workflow.ts:65](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L65)

Default retry policy applied to every `ctx.step()` call that
 doesn't carry its own `{ retry }` option.

***

### description?

```ts
optional description: string;
```

Defined in: [packages/workflow-core/src/define/define-workflow.ts:49](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L49)

***

### id

```ts
id: string;
```

Defined in: [packages/workflow-core/src/define/define-workflow.ts:48](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L48)

***

### initialize()?

```ts
optional initialize: (args) => TStateSchema extends SchemaInput ? Partial<InferSchema<TStateSchema<TStateSchema>>> : Record<string, unknown>;
```

Defined in: [packages/workflow-core/src/define/define-workflow.ts:56](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L56)

#### Parameters

##### args

###### input

`TInputSchema` *extends* [`SchemaInput`](../type-aliases/SchemaInput.md) ? [`InferSchema`](../type-aliases/InferSchema.md)\<`TInputSchema`\<`TInputSchema`\>\> : `unknown`

#### Returns

`TStateSchema` *extends* [`SchemaInput`](../type-aliases/SchemaInput.md) ? `Partial`\<[`InferSchema`](../type-aliases/InferSchema.md)\<`TStateSchema`\<`TStateSchema`\>\>\> : `Record`\<`string`, `unknown`\>

***

### input?

```ts
optional input: TInputSchema;
```

Defined in: [packages/workflow-core/src/define/define-workflow.ts:53](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L53)

***

### output?

```ts
optional output: TOutputSchema;
```

Defined in: [packages/workflow-core/src/define/define-workflow.ts:54](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L54)

***

### state?

```ts
optional state: TStateSchema;
```

Defined in: [packages/workflow-core/src/define/define-workflow.ts:55](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L55)

***

### version?

```ts
optional version: string;
```

Defined in: [packages/workflow-core/src/define/define-workflow.ts:52](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/define/define-workflow.ts#L52)

Caller-supplied version identifier (e.g. 'v1', '2026-05-15').
 Used with `selectWorkflowVersion` for cross-version routing.
