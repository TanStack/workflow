---
id: StepContext
title: StepContext
---

# Interface: StepContext

Defined in: [packages/workflow-core/src/types.ts:224](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L224)

Passed to a `ctx.step()` function. The deterministic `id` is the
idempotency-key candidate for external systems — it stays the same
across retries within a single step's execution AND across replays
of the same run.

## Properties

### attempt

```ts
attempt: number;
```

Defined in: [packages/workflow-core/src/types.ts:228](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L228)

Current attempt number (1-indexed).

***

### id

```ts
id: string;
```

Defined in: [packages/workflow-core/src/types.ts:226](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L226)

Deterministic step ID. Stable across retries and replays.

***

### signal

```ts
signal: AbortSignal;
```

Defined in: [packages/workflow-core/src/types.ts:232](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L232)

Per-attempt AbortSignal. Fires on:
  - step timeout firing
  - run-level abort (Ctrl+C / external cancellation)
