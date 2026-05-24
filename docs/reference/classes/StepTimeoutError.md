---
id: StepTimeoutError
title: StepTimeoutError
---

# Class: StepTimeoutError

Defined in: [packages/workflow-core/src/types.ts:567](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L567)

Thrown when a `ctx.step()` with `{ timeout }` exceeds its
 wall-clock budget on a given attempt.

## Extends

- `Error`

## Constructors

### Constructor

```ts
new StepTimeoutError(stepId, timeoutMs): StepTimeoutError;
```

Defined in: [packages/workflow-core/src/types.ts:569](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L569)

#### Parameters

##### stepId

`string`

##### timeoutMs

`number`

#### Returns

`StepTimeoutError`

#### Overrides

```ts
Error.constructor
```

## Properties

### cause?

```ts
optional cause: unknown;
```

Defined in: node\_modules/.pnpm/typescript@6.0.3/node\_modules/typescript/lib/lib.es2022.error.d.ts:24

#### Inherited from

```ts
Error.cause
```

***

### message

```ts
message: string;
```

Defined in: node\_modules/.pnpm/typescript@6.0.3/node\_modules/typescript/lib/lib.es5.d.ts:1075

#### Inherited from

```ts
Error.message
```

***

### name

```ts
readonly name: "StepTimeoutError" = 'StepTimeoutError';
```

Defined in: [packages/workflow-core/src/types.ts:568](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L568)

#### Overrides

```ts
Error.name
```

***

### stack?

```ts
optional stack: string;
```

Defined in: node\_modules/.pnpm/typescript@6.0.3/node\_modules/typescript/lib/lib.es5.d.ts:1076

#### Inherited from

```ts
Error.stack
```

***

### stepId

```ts
readonly stepId: string;
```

Defined in: [packages/workflow-core/src/types.ts:570](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L570)

***

### timeoutMs

```ts
readonly timeoutMs: number;
```

Defined in: [packages/workflow-core/src/types.ts:571](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L571)
