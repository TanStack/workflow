---
id: WorkflowTelemetry
title: WorkflowTelemetry
---

# Interface: WorkflowTelemetry

Defined in: [packages/workflow-core/src/telemetry.ts:43](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/telemetry.ts#L43)

## Properties

### addActiveSpanEvent()

```ts
addActiveSpanEvent: (name, attributes?) => void;
```

Defined in: [packages/workflow-core/src/telemetry.ts:52](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/telemetry.ts#L52)

#### Parameters

##### name

`string`

##### attributes?

`Attributes`

#### Returns

`void`

***

### enabled

```ts
enabled: boolean;
```

Defined in: [packages/workflow-core/src/telemetry.ts:44](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/telemetry.ts#L44)

***

### mapStepMeta()

```ts
mapStepMeta: (meta, ctx) => Attributes | undefined;
```

Defined in: [packages/workflow-core/src/telemetry.ts:53](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/telemetry.ts#L53)

#### Parameters

##### meta

[`WorkflowMetadata`](../type-aliases/WorkflowMetadata.md) | `undefined`

##### ctx

[`WorkflowTelemetryStepMetaContext`](WorkflowTelemetryStepMetaContext.md)

#### Returns

`Attributes` \| `undefined`

***

### spanNamePrefix

```ts
spanNamePrefix: string;
```

Defined in: [packages/workflow-core/src/telemetry.ts:45](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/telemetry.ts#L45)

***

### startActiveSpan()

```ts
startActiveSpan: <T>(operation, spanContext, fn, attributes?) => Promise<T>;
```

Defined in: [packages/workflow-core/src/telemetry.ts:46](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/telemetry.ts#L46)

#### Type Parameters

##### T

`T`

#### Parameters

##### operation

`string`

##### spanContext

[`WorkflowTelemetrySpanContext`](WorkflowTelemetrySpanContext.md)

##### fn

(`span`) => `T` \| `Promise`\<`T`\>

##### attributes?

`Attributes`

#### Returns

`Promise`\<`T`\>
