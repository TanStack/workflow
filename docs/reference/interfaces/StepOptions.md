---
id: StepOptions
title: StepOptions
---

# Interface: StepOptions

Defined in: [packages/workflow-core/src/types.ts:271](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L271)

## Properties

### meta?

```ts
optional meta: WorkflowMetadata;
```

Defined in: [packages/workflow-core/src/types.ts:273](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L273)

Free-form host/UI metadata copied into STEP_* log events.

***

### retry?

```ts
optional retry: StepRetryOptions;
```

Defined in: [packages/workflow-core/src/types.ts:274](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L274)

***

### timeout?

```ts
optional timeout: number;
```

Defined in: [packages/workflow-core/src/types.ts:276](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L276)

Per-attempt timeout in ms.
