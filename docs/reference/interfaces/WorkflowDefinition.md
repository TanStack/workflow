---
id: WorkflowDefinition
title: WorkflowDefinition
---

# Interface: WorkflowDefinition\<TInput, TOutput, TState\>

Defined in: [packages/workflow-core/src/types.ts:415](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L415)

## Type Parameters

### TInput

`TInput` = `unknown`

### TOutput

`TOutput` = `unknown`

### TState

`TState` = `Record`\<`string`, `unknown`\>

## Properties

### \_\_kind

```ts
__kind: "workflow";
```

Defined in: [packages/workflow-core/src/types.ts:420](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L420)

***

### defaultStepRetry?

```ts
optional defaultStepRetry: StepRetryOptions;
```

Defined in: [packages/workflow-core/src/types.ts:434](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L434)

***

### description?

```ts
optional description: string;
```

Defined in: [packages/workflow-core/src/types.ts:422](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L422)

***

### handler()

```ts
handler: (ctx) => Promise<TOutput>;
```

Defined in: [packages/workflow-core/src/types.ts:436](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L436)

#### Parameters

##### ctx

`any`

#### Returns

`Promise`\<`TOutput`\>

***

### id

```ts
id: string;
```

Defined in: [packages/workflow-core/src/types.ts:421](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L421)

***

### initialize()?

```ts
optional initialize: (args) => Partial<TState>;
```

Defined in: [packages/workflow-core/src/types.ts:433](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L433)

#### Parameters

##### args

###### input

`TInput`

#### Returns

`Partial`\<`TState`\>

***

### inputSchema?

```ts
optional inputSchema: SchemaInput;
```

Defined in: [packages/workflow-core/src/types.ts:430](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L430)

***

### middlewares

```ts
middlewares: readonly AnyMiddleware[];
```

Defined in: [packages/workflow-core/src/types.ts:435](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L435)

***

### outputSchema?

```ts
optional outputSchema: SchemaInput;
```

Defined in: [packages/workflow-core/src/types.ts:431](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L431)

***

### previousVersions?

```ts
optional previousVersions: readonly WorkflowDefinition<any, any, any>[];
```

Defined in: [packages/workflow-core/src/types.ts:429](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L429)

Older versions of this workflow that may still have in-flight
 runs. The engine routes a run's resume call to the version whose
 identifier matches the run's persisted `workflowVersion`.

***

### stateSchema?

```ts
optional stateSchema: SchemaInput;
```

Defined in: [packages/workflow-core/src/types.ts:432](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L432)

***

### version?

```ts
optional version: string;
```

Defined in: [packages/workflow-core/src/types.ts:425](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L425)

Caller-supplied version identifier. Used with `previousVersions`
 and `selectWorkflowVersion` for cross-version routing.
