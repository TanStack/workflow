---
id: WorkflowDefinition
title: WorkflowDefinition
---

# Interface: WorkflowDefinition\<TInput, TOutput, TState\>

Defined in: [packages/workflow-core/src/types.ts:474](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L474)

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

Defined in: [packages/workflow-core/src/types.ts:479](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L479)

***

### defaultStepRetry?

```ts
optional defaultStepRetry: StepRetryOptions;
```

Defined in: [packages/workflow-core/src/types.ts:493](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L493)

***

### description?

```ts
optional description: string;
```

Defined in: [packages/workflow-core/src/types.ts:481](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L481)

***

### handler()

```ts
handler: (ctx) => Promise<TOutput>;
```

Defined in: [packages/workflow-core/src/types.ts:495](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L495)

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

Defined in: [packages/workflow-core/src/types.ts:480](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L480)

***

### initialize()?

```ts
optional initialize: (args) => Partial<TState>;
```

Defined in: [packages/workflow-core/src/types.ts:492](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L492)

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

Defined in: [packages/workflow-core/src/types.ts:489](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L489)

***

### middlewares

```ts
middlewares: readonly AnyMiddleware[];
```

Defined in: [packages/workflow-core/src/types.ts:494](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L494)

***

### outputSchema?

```ts
optional outputSchema: SchemaInput;
```

Defined in: [packages/workflow-core/src/types.ts:490](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L490)

***

### previousVersions?

```ts
optional previousVersions: readonly WorkflowDefinition<any, any, any>[];
```

Defined in: [packages/workflow-core/src/types.ts:488](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L488)

Older versions of this workflow that may still have in-flight
 runs. The engine routes a run's resume call to the version whose
 identifier matches the run's persisted `workflowVersion`.

***

### stateSchema?

```ts
optional stateSchema: SchemaInput;
```

Defined in: [packages/workflow-core/src/types.ts:491](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L491)

***

### version?

```ts
optional version: string;
```

Defined in: [packages/workflow-core/src/types.ts:484](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L484)

Caller-supplied version identifier. Used with `previousVersions`
 and `selectWorkflowVersion` for cross-version routing.
