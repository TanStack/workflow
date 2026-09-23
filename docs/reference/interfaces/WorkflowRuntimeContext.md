---
id: WorkflowRuntimeContext
title: WorkflowRuntimeContext
---

# Interface: WorkflowRuntimeContext

Defined in: [packages/workflow-core/src/types.ts:325](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L325)

## Extends

- [`StepRuntimeContext`](StepRuntimeContext.md)

## Properties

### deadline?

```ts
optional deadline: number;
```

Defined in: [packages/workflow-core/src/types.ts:318](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L318)

Absolute UTC ms runtime deadline, when the runtime supplied one.

#### Inherited from

[`StepRuntimeContext`](StepRuntimeContext.md).[`deadline`](StepRuntimeContext.md#deadline)

***

### shouldYield()

```ts
shouldYield: (options?) => boolean;
```

Defined in: [packages/workflow-core/src/types.ts:322](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L322)

True when the runtime is too close to its deadline for fresh work.

#### Parameters

##### options?

[`ShouldYieldOptions`](ShouldYieldOptions.md)

#### Returns

`boolean`

#### Inherited from

[`StepRuntimeContext`](StepRuntimeContext.md).[`shouldYield`](StepRuntimeContext.md#shouldyield)

***

### timeRemaining()

```ts
timeRemaining: () => number;
```

Defined in: [packages/workflow-core/src/types.ts:320](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L320)

Remaining runtime budget in ms. Returns Infinity when unbounded.

#### Returns

`number`

#### Inherited from

[`StepRuntimeContext`](StepRuntimeContext.md).[`timeRemaining`](StepRuntimeContext.md#timeremaining)

***

### yield()

```ts
yield: (options?) => Promise<void>;
```

Defined in: [packages/workflow-core/src/types.ts:326](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L326)

#### Parameters

##### options?

[`YieldOptions`](YieldOptions.md)

#### Returns

`Promise`\<`void`\>
