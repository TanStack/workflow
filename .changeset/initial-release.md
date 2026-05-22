---
'@tanstack/workflow-core': patch
---

Initial public release.

Type-safe durable execution engine for TypeScript. Closure-based workflows with replay-driven durability, pause/resume on approvals and signals, typed middleware that extends `ctx`, an append-only event log that doubles as the UI transport, and a pluggable `RunStore` interface.

Primitives on `ctx`: `step`, `sleep` / `sleepUntil`, `waitForEvent`, `approve`, `now`, `uuid`, `retry`, `emit`. Cross-version routing via `previousVersions`. Webhook entry point alongside long-running `runWorkflow`. In-memory `RunStore` with push subscription.

See [docs/overview.md](https://github.com/TanStack/workflow/blob/main/docs/overview.md) for the mental model, [docs/quick-start.md](https://github.com/TanStack/workflow/blob/main/docs/quick-start.md) for copy-paste recipes, and [docs/concepts/](https://github.com/TanStack/workflow/blob/main/docs/concepts/) for the primitives / middleware / replay / scheduling references.

Extracted from [`@tanstack/ai-orchestration`](https://github.com/TanStack/ai/pull/542) (Alem Tuzlak + Tom Beckenham). The AI-specific surface (agents, orchestrators) stays in ai-orchestration and composes on top.
