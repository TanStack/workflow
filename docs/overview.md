---
id: overview
title: Overview
---

TanStack Workflow is a durable execution engine for TypeScript. Workflows are
async functions that pause, persist, and resume across process restarts.

The goal is durable workflows without making a workflow platform the center of
your application. Your workflow code stays in your app, your durability boundary
stays in a store you choose, and the same workflow model can run across
Cloudflare, Railway, Netlify, Node, AWS, Vercel, or your own infrastructure.

## Why TanStack Workflow

Most workflow systems solve durability by asking you to adopt their control
plane, hosted runtime, or state-machine service. TanStack Workflow is the
headless option: a TypeScript engine, explicit durable primitives, a storage
contract, and adapters for the environments you already deploy to.

Use TanStack Workflow when you want:

- long-running app logic without long-running processes
- durable steps, sleeps, signals, and approvals in plain TypeScript
- persistence you own or configure
- workflow code that can move between deployment providers
- TanStack-style primitives instead of a separate workflow platform

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

## Runtime shape

The production path has three layers:

- `@tanstack/workflow-core`: the replay engine and workflow authoring API.
- `@tanstack/workflow-runtime`: registered workflows, execution store contract,
  schedules, timers, signals, approvals, leases, and bounded sweeps.
- Store and host adapters: Postgres, Cloudflare D1, Cloudflare Workers,
  Railway, Netlify, Node, Vercel, queues, and other environment-specific
  capabilities.

This keeps the engine headless without leaving deployment mechanics as an
exercise for every user.

## Status

`@tanstack/workflow-core` ships the engine and the in-memory `RunStore`.
`@tanstack/workflow-runtime` is the experimental durable runtime layer.
`@tanstack/workflow-store-drizzle-postgres`,
`@tanstack/workflow-store-cloudflare-d1`, `@tanstack/workflow-vercel`, and
`@tanstack/workflow-netlify` are experimental capability adapters.

Start with the [Guide](guide/index.md) for the full production model.
