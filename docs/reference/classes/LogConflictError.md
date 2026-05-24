---
id: LogConflictError
title: LogConflictError
---

# Class: LogConflictError

Defined in: [packages/workflow-core/src/types.ts:552](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L552)

Thrown by `RunStore.appendEvent` when another writer has already
committed a record at the requested index. The engine catches it
and decides whether to treat as idempotent (same signalId) or as
a lost race (different signalId).

## Extends

- `Error`

## Constructors

### Constructor

```ts
new LogConflictError(
   runId, 
   attemptedIndex, 
   existing?): LogConflictError;
```

Defined in: [packages/workflow-core/src/types.ts:554](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L554)

#### Parameters

##### runId

`string`

##### attemptedIndex

`number`

##### existing?

[`WorkflowEvent`](../type-aliases/WorkflowEvent.md)

#### Returns

`LogConflictError`

#### Overrides

```ts
Error.constructor
```

## Properties

### attemptedIndex

```ts
readonly attemptedIndex: number;
```

Defined in: [packages/workflow-core/src/types.ts:556](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L556)

***

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

### existing?

```ts
readonly optional existing: WorkflowEvent;
```

Defined in: [packages/workflow-core/src/types.ts:557](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L557)

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
readonly name: "LogConflictError" = 'LogConflictError';
```

Defined in: [packages/workflow-core/src/types.ts:553](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L553)

#### Overrides

```ts
Error.name
```

***

### runId

```ts
readonly runId: string;
```

Defined in: [packages/workflow-core/src/types.ts:555](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L555)

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
