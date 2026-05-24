---
id: BaseCtx
title: BaseCtx
---

# Interface: BaseCtx\<TInput, TState\>

Defined in: [packages/workflow-core/src/types.ts:271](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L271)

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

Defined in: [packages/workflow-core/src/types.ts:290](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L290)

#### Parameters

##### options

[`ApproveOptions`](ApproveOptions.md)

#### Returns

`Promise`\<[`ApprovalResult`](ApprovalResult.md)\>

***

### emit()

```ts
emit: (name, value) => void;
```

Defined in: [packages/workflow-core/src/types.ts:297](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L297)

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

Defined in: [packages/workflow-core/src/types.ts:273](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L273)

***

### now()

```ts
now: () => Promise<number>;
```

Defined in: [packages/workflow-core/src/types.ts:291](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L291)

#### Returns

`Promise`\<`number`\>

***

### runId

```ts
runId: string;
```

Defined in: [packages/workflow-core/src/types.ts:272](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L272)

***

### signal

```ts
signal: AbortSignal;
```

Defined in: [packages/workflow-core/src/types.ts:276](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L276)

AbortSignal for the run as a whole.

***

### sleep()

```ts
sleep: (ms) => Promise<void>;
```

Defined in: [packages/workflow-core/src/types.ts:284](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L284)

#### Parameters

##### ms

`number`

#### Returns

`Promise`\<`void`\>

***

### sleepUntil()

```ts
sleepUntil: (timestamp) => Promise<void>;
```

Defined in: [packages/workflow-core/src/types.ts:285](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L285)

#### Parameters

##### timestamp

`number`

#### Returns

`Promise`\<`void`\>

***

### state

```ts
state: TState;
```

Defined in: [packages/workflow-core/src/types.ts:274](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L274)

***

### step()

```ts
step: <T>(id, fn, options?) => Promise<T>;
```

Defined in: [packages/workflow-core/src/types.ts:279](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L279)

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
uuid: () => Promise<string>;
```

Defined in: [packages/workflow-core/src/types.ts:292](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L292)

#### Returns

`Promise`\<`string`\>

***

### waitForEvent()

```ts
waitForEvent: <TPayload>(name, options?) => Promise<TPayload>;
```

Defined in: [packages/workflow-core/src/types.ts:286](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L286)

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
