---
id: BaseCtx
title: BaseCtx
---

# Interface: BaseCtx\<TInput, TState\>

Defined in: [packages/workflow-core/src/types.ts:347](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L347)

Built-in fields on every ctx. Middleware can add fields via the
 `TExtensions` generic but cannot shadow these.

## Type Parameters

### TInput

`TInput`

### TState

`TState`

## Properties

### approve()

```ts
approve: (options) => Promise<ApprovalResult>;
```

Defined in: [packages/workflow-core/src/types.ts:377](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L377)

#### Parameters

##### options

[`ApproveOptions`](ApproveOptions.md)

#### Returns

`Promise`\<[`ApprovalResult`](ApprovalResult.md)\>

***

### compensate()

```ts
compensate: (id, fn, options?) => Promise<void>;
```

Defined in: [packages/workflow-core/src/types.ts:360](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L360)

Register an idempotent undo handler. On an uncaught workflow failure,
handlers run in reverse registration order with durable step checkpoints.
Registration and captured values must be replayable.

#### Parameters

##### id

`string`

##### fn

(`ctx`) => `unknown`

##### options?

[`StepOptions`](StepOptions.md)

#### Returns

`Promise`\<`void`\>

***

### emit()

```ts
emit: (name, value) => void;
```

Defined in: [packages/workflow-core/src/types.ts:384](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L384)

Emit a CUSTOM event for UI/devtools consumption. Does not enter
 the replay log.

#### Parameters

##### name

`string`

##### value

`Record`\<`string`, `unknown`\>

#### Returns

`void`

***

### input

```ts
input: TInput;
```

Defined in: [packages/workflow-core/src/types.ts:349](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L349)

***

### now()

```ts
now: (options?) => Promise<number>;
```

Defined in: [packages/workflow-core/src/types.ts:378](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L378)

#### Parameters

##### options?

[`DeterministicValueOptions`](DeterministicValueOptions.md)

#### Returns

`Promise`\<`number`\>

***

### runId

```ts
runId: string;
```

Defined in: [packages/workflow-core/src/types.ts:348](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L348)

***

### runtime

```ts
runtime: WorkflowRuntimeContext;
```

Defined in: [packages/workflow-core/src/types.ts:354](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L354)

Current runtime-drive metadata and budget helpers.

***

### signal

```ts
signal: AbortSignal;
```

Defined in: [packages/workflow-core/src/types.ts:352](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L352)

AbortSignal for the run as a whole.

***

### sleep()

```ts
sleep: (ms, options?) => Promise<void>;
```

Defined in: [packages/workflow-core/src/types.ts:371](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L371)

#### Parameters

##### ms

`number`

##### options?

[`SleepOptions`](SleepOptions.md)

#### Returns

`Promise`\<`void`\>

***

### sleepUntil()

```ts
sleepUntil: (timestamp, options?) => Promise<void>;
```

Defined in: [packages/workflow-core/src/types.ts:372](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L372)

#### Parameters

##### timestamp

`number`

##### options?

[`SleepOptions`](SleepOptions.md)

#### Returns

`Promise`\<`void`\>

***

### state

```ts
state: TState;
```

Defined in: [packages/workflow-core/src/types.ts:350](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L350)

***

### step()

```ts
step: <T>(id, fn, options?) => Promise<T>;
```

Defined in: [packages/workflow-core/src/types.ts:366](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L366)

#### Type Parameters

##### T

`T`

#### Parameters

##### id

`string`

##### fn

(`stepCtx`) => `T` \| `Promise`\<`T`\>

##### options?

[`StepOptions`](StepOptions.md)

#### Returns

`Promise`\<`T`\>

***

### uuid()

```ts
uuid: (options?) => Promise<string>;
```

Defined in: [packages/workflow-core/src/types.ts:379](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L379)

#### Parameters

##### options?

[`DeterministicValueOptions`](DeterministicValueOptions.md)

#### Returns

`Promise`\<`string`\>

***

### waitForEvent()

```ts
waitForEvent: <TPayload>(name, options?) => Promise<TPayload>;
```

Defined in: [packages/workflow-core/src/types.ts:373](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L373)

#### Type Parameters

##### TPayload

`TPayload` = `unknown`

#### Parameters

##### name

`string`

##### options?

[`WaitForEventOptions`](WaitForEventOptions.md)\<`TPayload`\>

#### Returns

`Promise`\<`TPayload`\>
