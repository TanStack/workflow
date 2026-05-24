---
id: WorkflowDefinition
title: WorkflowDefinition
---

# Interface: WorkflowDefinition\<TInput, TOutput, TState\>

Defined in: [packages/workflow-core/src/types.ts:385](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L385)

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

Defined in: [packages/workflow-core/src/types.ts:390](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L390)

***

### defaultStepRetry?

```ts
optional defaultStepRetry: StepRetryOptions;
```

Defined in: [packages/workflow-core/src/types.ts:404](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L404)

***

### description?

```ts
optional description: string;
```

Defined in: [packages/workflow-core/src/types.ts:392](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L392)

***

### handler()

```ts
handler: (ctx) => Promise<TOutput>;
```

Defined in: [packages/workflow-core/src/types.ts:406](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L406)

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

Defined in: [packages/workflow-core/src/types.ts:391](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L391)

***

### initialize()?

```ts
optional initialize: (args) => Partial<TState>;
```

Defined in: [packages/workflow-core/src/types.ts:403](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L403)

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

Defined in: [packages/workflow-core/src/types.ts:400](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L400)

***

### middlewares

```ts
middlewares: readonly AnyMiddleware[];
```

Defined in: [packages/workflow-core/src/types.ts:405](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L405)

***

### outputSchema?

```ts
optional outputSchema: SchemaInput;
```

Defined in: [packages/workflow-core/src/types.ts:401](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L401)

***

### previousVersions?

```ts
optional previousVersions: readonly WorkflowDefinition<any, any, any>[];
```

Defined in: [packages/workflow-core/src/types.ts:399](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L399)

Older versions of this workflow that may still have in-flight
 runs. The engine routes a run's resume call to the version whose
 identifier matches the run's persisted `workflowVersion`.

***

### stateSchema?

```ts
optional stateSchema: SchemaInput;
```

Defined in: [packages/workflow-core/src/types.ts:402](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L402)

***

### version?

```ts
optional version: string;
```

Defined in: [packages/workflow-core/src/types.ts:395](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L395)

Caller-supplied version identifier. Used with `previousVersions`
 and `selectWorkflowVersion` for cross-version routing.
