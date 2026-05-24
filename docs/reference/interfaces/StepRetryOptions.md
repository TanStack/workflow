---
id: StepRetryOptions
title: StepRetryOptions
---

# Interface: StepRetryOptions

Defined in: [packages/workflow-core/src/types.ts:214](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L214)

## Properties

### backoff?

```ts
optional backoff: "exponential" | "fixed" | (attempt) => number;
```

Defined in: [packages/workflow-core/src/types.ts:218](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L218)

Backoff between attempts. Default: 'exponential'.

***

### baseMs?

```ts
optional baseMs: number;
```

Defined in: [packages/workflow-core/src/types.ts:220](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L220)

Base delay in ms for built-in backoff strategies. Default: 500.

***

### maxAttempts

```ts
maxAttempts: number;
```

Defined in: [packages/workflow-core/src/types.ts:216](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L216)

Maximum total attempts including the first try. Must be >= 1.

***

### shouldRetry()?

```ts
optional shouldRetry: (err, attempt) => boolean;
```

Defined in: [packages/workflow-core/src/types.ts:223](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L223)

Predicate to decide whether a given error should be retried.
 Default: retry every error.

#### Parameters

##### err

`unknown`

##### attempt

`number`

#### Returns

`boolean`
