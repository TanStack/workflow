---
id: api
title: API Reference
---

# API reference

This section is the human-authored API reference for the runtime, store, and
host adapter packages.

The generated reference for `@tanstack/workflow-core` still lives in
[Generated core reference](../reference/index.md).

## Packages

| Package | API page |
| --- | --- |
| `@tanstack/workflow-core` | [Core API](core.md) |
| `@tanstack/workflow-runtime` | [Runtime API](runtime.md) |
| `@tanstack/workflow-store-drizzle-postgres` | [Store adapters](store-adapters.md) |
| `@tanstack/workflow-cloudflare`, `@tanstack/workflow-railway`, `@tanstack/workflow-netlify`, and `@tanstack/workflow-vercel` | [Host adapters](host-adapters.md) |

## Which API should I start with?

Use `@tanstack/workflow-core` directly when:

- you are writing tests
- you are embedding the replay engine into your own runtime
- you want to handle persistence, timers, and signals yourself

Use `@tanstack/workflow-runtime` when:

- you want registered workflows
- you need schedules and timer sweeps
- you need a production store contract
- you deploy to serverless or multiple workers

Use host adapters when:

- you want a provider-native cron or scheduled function entrypoint
- you want compact sweep responses
- you want deployment examples that fit the host

## Stability

The runtime and adapter packages are experimental. The direction is stable:

- core stays small
- runtime owns durable execution orchestration
- stores implement a contract
- host adapters stay thin

Some names and option shapes may still change while the first production guides
settle.
