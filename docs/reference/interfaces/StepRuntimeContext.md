---
id: StepRuntimeContext
title: StepRuntimeContext
---

# Interface: StepRuntimeContext

Defined in: [packages/workflow-core/src/types.ts:316](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L316)

## Extended by

- [`WorkflowRuntimeContext`](WorkflowRuntimeContext.md)

## Properties

### deadline?

```ts
optional deadline: number;
```

Defined in: [packages/workflow-core/src/types.ts:318](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L318)

Absolute UTC ms runtime deadline, when the runtime supplied one.

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

***

### timeRemaining()

```ts
timeRemaining: () => number;
```

Defined in: [packages/workflow-core/src/types.ts:320](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L320)

Remaining runtime budget in ms. Returns Infinity when unbounded.

#### Returns

`number`
