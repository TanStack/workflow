# @tanstack/run-core

Type-safe durable execution engine for TanStack Run.

Framework-agnostic core. Async-generator workflows with replay-based durability, deterministic primitives (`step`, `sleep`, `waitForSignal`, `approve`, `now`, `uuid`, `retry`, `patched`), pluggable run store, and append-only step log.

> Initial extraction from [`@tanstack/ai-orchestration`](https://github.com/TanStack/ai/pull/542) (Alem Tuzlak + Tom Beckenham). The AI-specific surface (agents, orchestrators, AG-UI integration) stays in `@tanstack/ai-orchestration` and composes on top of this package.

## Status

Pre-alpha. APIs will change.
