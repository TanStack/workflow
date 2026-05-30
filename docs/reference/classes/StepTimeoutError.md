---
id: StepTimeoutError
title: StepTimeoutError
---

# Class: StepTimeoutError

Defined in: [packages/workflow-core/src/types.ts:626](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L626)

Thrown when a `ctx.step()` with `{ timeout }` exceeds its
 wall-clock budget on a given attempt.

## Extends

- `Error`

## Constructors

### Constructor

```ts
new StepTimeoutError(stepId, timeoutMs): StepTimeoutError;
```

Defined in: [packages/workflow-core/src/types.ts:628](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L628)

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

Defined in: [packages/workflow-core/src/types.ts:627](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L627)

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

Defined in: [packages/workflow-core/src/types.ts:629](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L629)

***

### timeoutMs

```ts
readonly timeoutMs: number;
```

Defined in: [packages/workflow-core/src/types.ts:630](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L630)
