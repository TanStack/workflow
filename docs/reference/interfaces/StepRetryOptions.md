---
id: StepRetryOptions
title: StepRetryOptions
---

# Interface: StepRetryOptions

Defined in: [packages/workflow-core/src/types.ts:256](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L256)

## Properties

### backoff?

```ts
optional backoff: "exponential" | "fixed" | (attempt) => number;
```

Defined in: [packages/workflow-core/src/types.ts:263](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L263)

Backoff between attempts. Default: 'exponential'.

***

### baseMs?

```ts
optional baseMs: number;
```

Defined in: [packages/workflow-core/src/types.ts:265](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L265)

Base delay in ms for built-in backoff strategies. Default: 500.

***

### durable?

```ts
optional durable: boolean;
```

Defined in: [packages/workflow-core/src/types.ts:259](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L259)

Persist failed attempts and pause between retries. Requires a host that
resumes timer waits. The default keeps the existing in-process retries.

***

### maxAttempts

```ts
maxAttempts: number;
```

Defined in: [packages/workflow-core/src/types.ts:261](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L261)

Maximum total attempts including the first try. Must be >= 1.

***

### shouldRetry()?

```ts
optional shouldRetry: (err, attempt) => boolean;
```

Defined in: [packages/workflow-core/src/types.ts:268](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L268)

Predicate to decide whether a given error should be retried.
 Default: retry every error.

#### Parameters

##### err

`unknown`

##### attempt

`number`

#### Returns

`boolean`
