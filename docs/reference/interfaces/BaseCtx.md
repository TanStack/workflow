---
id: BaseCtx
title: BaseCtx
---

# Interface: BaseCtx\<TInput, TState\>

Defined in: [packages/workflow-core/src/types.ts:301](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L301)

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

Defined in: [packages/workflow-core/src/types.ts:320](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L320)

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

Defined in: [packages/workflow-core/src/types.ts:327](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L327)

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

Defined in: [packages/workflow-core/src/types.ts:303](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L303)

***

### now()

```ts
now: (options?) => Promise<number>;
```

Defined in: [packages/workflow-core/src/types.ts:321](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L321)

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

Defined in: [packages/workflow-core/src/types.ts:302](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L302)

***

### signal

```ts
signal: AbortSignal;
```

Defined in: [packages/workflow-core/src/types.ts:306](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L306)

AbortSignal for the run as a whole.

***

### sleep()

```ts
sleep: (ms, options?) => Promise<void>;
```

Defined in: [packages/workflow-core/src/types.ts:314](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L314)

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

Defined in: [packages/workflow-core/src/types.ts:315](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L315)

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

Defined in: [packages/workflow-core/src/types.ts:304](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L304)

***

### step()

```ts
step: <T>(id, fn, options?) => Promise<T>;
```

Defined in: [packages/workflow-core/src/types.ts:309](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L309)

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

Defined in: [packages/workflow-core/src/types.ts:322](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L322)

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

Defined in: [packages/workflow-core/src/types.ts:316](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L316)

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
