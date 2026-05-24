---
id: StepContext
title: StepContext
---

# Interface: StepContext

Defined in: [packages/workflow-core/src/types.ts:203](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L203)

Passed to a `ctx.step()` function. The deterministic `id` is the
idempotency-key candidate for external systems — it stays the same
across retries within a single step's execution AND across replays
of the same run.

## Properties

### attempt

```ts
attempt: number;
```

Defined in: [packages/workflow-core/src/types.ts:207](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L207)

Current attempt number (1-indexed).

***

### id

```ts
id: string;
```

Defined in: [packages/workflow-core/src/types.ts:205](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L205)

Deterministic step ID. Stable across retries and replays.

***

### signal

```ts
signal: AbortSignal;
```

Defined in: [packages/workflow-core/src/types.ts:211](https://github.com/TanStack/workflow/blob/main/packages/workflow-core/src/types.ts#L211)

Per-attempt AbortSignal. Fires on:
  - step timeout firing
  - run-level abort (Ctrl+C / external cancellation)
