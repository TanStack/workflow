# Overview

TanStack Workflow is a durable execution engine for TypeScript. Workflows are async functions that pause, persist, and resume across process restarts.

## Mental model

1. A workflow is a **closure** — `async (ctx) => ...`. Plain JS control flow.
2. Every durable call goes through `ctx.*` and writes to an append-only **event log**.
3. State is **derived** — reconstructed by replaying the log + re-running the handler. Never persisted directly.
4. Pause = handler throws an internal sentinel. Resume = run the handler again; replay short-circuits past completed work.

## Three things go in / two things come out

```
Input  ──┐                         ┌── Output (handler's return value)
         │                         │
         ▼                         │
   createWorkflow({...})           │
       ⇒ handler(ctx) ─────────────┘
                │
                ├─ writes ──▶ Event log (durability + UI transport)
                │
                └─ reads ◀── RunState (status, version, pause info)
```

The event log is the source of truth. The browser subscribes to the same log via the runStore.

## Authoring rules

- Side effects go inside `ctx.step(id, fn)`. Bare `fetch()` / `db.x()` outside a step is a determinism violation.
- Use `ctx.now()` / `ctx.uuid()` — not `Date.now()` / `crypto.randomUUID()`.
- Step IDs must be unique per call site. Loops use interpolation: `ctx.step(\`charge-${i}\`, fn)`.
- Helpers take `ctx: WorkflowCtx<TExt>` and call primitives through it. No ambient state.

## What persists vs what doesn't

| In the log (durable) | Emit-only (observability) |
|---|---|
| `STEP_FINISHED` / `STEP_FAILED` | `RUN_STARTED` |
| `SIGNAL_AWAITED` / `SIGNAL_RESOLVED` | `STEP_STARTED` |
| `APPROVAL_REQUESTED` / `APPROVAL_RESOLVED` | `STATE_DELTA` |
| `NOW_RECORDED` / `UUID_RECORDED` | `CUSTOM` (`ctx.emit`) |
| `RUN_FINISHED` / `RUN_ERRORED` | |

Replay reads the durable events. Live subscribers see both.

## Where it sits

- **Below**: any HTTP server (TanStack Start, Hono, Express), any persistence (in-memory, Postgres, Durable Objects).
- **Above**: agent frameworks (`@tanstack/ai-orchestration`), domain workflows in app code.
- **Beside**: TanStack DB (reactive state from the log), TanStack Query (client cache).

## Status

`@tanstack/workflow-core` ships the engine and the in-memory store. Storage adapters, framework bindings, and devtools land in follow-up packages.
