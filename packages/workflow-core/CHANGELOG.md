# @tanstack/workflow-core

## 0.0.3

### Patch Changes

- Add the workflow runtime, durable execution store contract, Drizzle/Postgres store, Vercel and Netlify host adapters, deployment POCs, and production docs.

## 0.0.2

### Patch Changes

- Harden workflow runtime validation and delivery matching, retain terminal run logs, and align docs/tooling with workflow-core.

## 0.0.1

### Patch Changes

- Initial public release. ([#5](https://github.com/TanStack/workflow/pull/5))

  Type-safe durable execution engine for TypeScript. Closure-based workflows with replay-driven durability, pause/resume on approvals and signals, typed middleware that extends `ctx`, an append-only event log that doubles as the UI transport, and a pluggable `RunStore` interface.

  Primitives on `ctx`: `step`, `sleep` / `sleepUntil`, `waitForEvent`, `approve`, `now`, `uuid`, `retry`, `emit`. Cross-version routing via `previousVersions`. Webhook entry point alongside long-running `runWorkflow`. In-memory `RunStore` with push subscription.

  See [docs/overview.md](https://github.com/TanStack/workflow/blob/main/docs/overview.md) for the mental model, [docs/quick-start.md](https://github.com/TanStack/workflow/blob/main/docs/quick-start.md) for copy-paste recipes, and [docs/concepts/](https://github.com/TanStack/workflow/blob/main/docs/concepts/) for the primitives / middleware / replay / scheduling references.

  Extracted from [`@tanstack/ai-orchestration`](https://github.com/TanStack/ai/pull/542) (Alem Tuzlak + Tom Beckenham). The AI-specific surface (agents, orchestrators) stays in ai-orchestration and composes on top.
