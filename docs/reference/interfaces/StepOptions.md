---
id: StepOptions
title: StepOptions
---

# Interface: StepOptions

Defined in: [packages/workflow-core/src/types.ts:247](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L247)

## Properties

### meta?

```ts
optional meta: WorkflowMetadata;
```

Defined in: [packages/workflow-core/src/types.ts:249](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L249)

Free-form host/UI metadata copied into STEP_* log events.

***

### retry?

```ts
optional retry: StepRetryOptions;
```

Defined in: [packages/workflow-core/src/types.ts:250](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L250)

***

### timeout?

```ts
optional timeout: number;
```

Defined in: [packages/workflow-core/src/types.ts:252](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L252)

Per-attempt timeout in ms.
