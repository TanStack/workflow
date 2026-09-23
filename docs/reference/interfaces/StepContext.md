---
id: StepContext
title: StepContext
---

# Interface: StepContext

Defined in: [packages/workflow-core/src/types.ts:243](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L243)

Passed to a `ctx.step()` function. The deterministic `id` is the
idempotency-key candidate for external systems — it stays the same
across retries within a single step's execution AND across replays
of the same run.

## Properties

### attempt

```ts
attempt: number;
```

Defined in: [packages/workflow-core/src/types.ts:247](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L247)

Current attempt number (1-indexed).

***

### id

```ts
id: string;
```

Defined in: [packages/workflow-core/src/types.ts:245](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L245)

Deterministic step ID. Stable across retries and replays.

***

### runtime

```ts
runtime: StepRuntimeContext;
```

Defined in: [packages/workflow-core/src/types.ts:249](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L249)

Current runtime-drive metadata and budget helpers.

***

### signal

```ts
signal: AbortSignal;
```

Defined in: [packages/workflow-core/src/types.ts:253](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L253)

Per-attempt AbortSignal. Fires on:
  - step timeout firing
  - run-level abort (Ctrl+C / external cancellation)
