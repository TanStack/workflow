# Installation

```bash
pnpm add @tanstack/workflow-core
```

Install `zod` or another [Standard Schema](https://github.com/standard-schema/standard-schema) library if you use `input` / `output` / `state` / `waitForEvent({ schema })` validation.

## Storage

Run state lives in a `RunStore`. Ships with one in-memory implementation:

```ts
import { inMemoryRunStore } from '@tanstack/workflow-core'
const runStore = inMemoryRunStore({ ttl: 60 * 60 * 1000 }) // 1h, paused runs exempt
```

Durable adapters (Postgres, SQLite, D1, Durable Objects, Redis) are forthcoming as `@tanstack/workflow-*` packages.

## Server framework

Engine is framework-agnostic. Two entry points:

- `runWorkflow({...})` — long-lived process or SSE handler. Returns `AsyncIterable<WorkflowEvent>`.
- `handleWorkflowWebhook({...})` — stateless one-invocation drive. Returns the appended events.

Use either with TanStack Start server functions, Hono, Express, Cloudflare Workers, AWS Lambda — anything that can receive an HTTP request.

## Framework bindings

None yet. React / Solid / Vue / Svelte hooks (`useWorkflow`) ship in follow-up packages.
