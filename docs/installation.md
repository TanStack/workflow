# Installation

```bash
pnpm add @tanstack/workflow-core
```

Install `zod` or another [Standard Schema](https://github.com/standard-schema/standard-schema) library if you use `input` / `output` / `state` / `waitForEvent({ schema })` validation.

## Runtime

For registered workflows, schedules, timers, leases, and host sweeps:

```bash
pnpm add @tanstack/workflow-core @tanstack/workflow-runtime
```

## Storage

Run state lives in a `RunStore`. Ships with one in-memory implementation:

```ts
import { inMemoryRunStore } from '@tanstack/workflow-core'
const runStore = inMemoryRunStore({ ttl: 60 * 60 * 1000 }) // 1h, paused runs exempt
```

The production runtime uses a richer `WorkflowExecutionStore`. For local tests:

```ts
import { inMemoryWorkflowExecutionStore } from '@tanstack/workflow-runtime'

const store = inMemoryWorkflowExecutionStore()
```

For Postgres:

```bash
pnpm add @tanstack/workflow-store-drizzle-postgres drizzle-orm pg
```

```ts
import { createDrizzlePostgresWorkflowStore } from '@tanstack/workflow-store-drizzle-postgres'

const store = createDrizzlePostgresWorkflowStore({ db })
await store.ensureSchema()
```

## Server framework

Engine is framework-agnostic. Two entry points:

- `runWorkflow({...})` — long-lived process or SSE handler. Returns `AsyncIterable<WorkflowEvent>`.
- `handleWorkflowWebhook({...})` — stateless one-invocation drive. Returns the appended events.

Use either with TanStack Start server functions, Hono, Express, Cloudflare Workers, AWS Lambda — anything that can receive an HTTP request.

The runtime adds:

- `runtime.startRun(...)`
- `runtime.deliverSignal(...)`
- `runtime.deliverApproval(...)`
- `runtime.sweep(...)`

## Host adapters

For Vercel:

```bash
pnpm add @tanstack/workflow-vercel
```

For Netlify:

```bash
pnpm add @tanstack/workflow-netlify
```

See the [Deployment guide](guide/deployment.md) for full setup.

## Framework bindings

None yet. React / Solid / Vue / Svelte hooks (`useWorkflow`) ship in follow-up packages.
