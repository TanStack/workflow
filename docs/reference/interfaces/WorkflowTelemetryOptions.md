---
id: WorkflowTelemetryOptions
title: WorkflowTelemetryOptions
---

# Interface: WorkflowTelemetryOptions

Defined in: [packages/workflow-core/src/telemetry.ts:29](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/telemetry.ts#L29)

## Properties

### attributes?

```ts
optional attributes: Attributes | (ctx) => Attributes | undefined;
```

Defined in: [packages/workflow-core/src/telemetry.ts:33](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/telemetry.ts#L33)

***

### enabled?

```ts
optional enabled: boolean;
```

Defined in: [packages/workflow-core/src/telemetry.ts:30](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/telemetry.ts#L30)

***

### mapStepMeta()?

```ts
optional mapStepMeta: (meta, ctx) => Attributes | undefined;
```

Defined in: [packages/workflow-core/src/telemetry.ts:37](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/telemetry.ts#L37)

#### Parameters

##### meta

[`WorkflowMetadata`](../type-aliases/WorkflowMetadata.md)

##### ctx

[`WorkflowTelemetryStepMetaContext`](WorkflowTelemetryStepMetaContext.md)

#### Returns

`Attributes` \| `undefined`

***

### recordExceptions?

```ts
optional recordExceptions: boolean;
```

Defined in: [packages/workflow-core/src/telemetry.ts:36](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/telemetry.ts#L36)

***

### spanNamePrefix?

```ts
optional spanNamePrefix: string;
```

Defined in: [packages/workflow-core/src/telemetry.ts:32](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/telemetry.ts#L32)

***

### tracer?

```ts
optional tracer: Tracer;
```

Defined in: [packages/workflow-core/src/telemetry.ts:31](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/telemetry.ts#L31)
