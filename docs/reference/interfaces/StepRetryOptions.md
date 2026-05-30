---
id: StepRetryOptions
title: StepRetryOptions
---

# Interface: StepRetryOptions

Defined in: [packages/workflow-core/src/types.ts:235](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L235)

## Properties

### backoff?

```ts
optional backoff: "exponential" | "fixed" | (attempt) => number;
```

Defined in: [packages/workflow-core/src/types.ts:239](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L239)

Backoff between attempts. Default: 'exponential'.

***

### baseMs?

```ts
optional baseMs: number;
```

Defined in: [packages/workflow-core/src/types.ts:241](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L241)

Base delay in ms for built-in backoff strategies. Default: 500.

***

### maxAttempts

```ts
maxAttempts: number;
```

Defined in: [packages/workflow-core/src/types.ts:237](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L237)

Maximum total attempts including the first try. Must be >= 1.

***

### shouldRetry()?

```ts
optional shouldRetry: (err, attempt) => boolean;
```

Defined in: [packages/workflow-core/src/types.ts:244](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L244)

Predicate to decide whether a given error should be retried.
 Default: retry every error.

#### Parameters

##### err

`unknown`

##### attempt

`number`

#### Returns

`boolean`
