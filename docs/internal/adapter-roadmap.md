# Workflow Adapter Roadmap

This is an internal planning note for Workflow adapters. The goal is to avoid
shipping a large adapter matrix before the reference adapters are boring,
tested, dogfooded, and deployed.

## Position

Adapter count is not the win. A small number of correct, well-documented,
deployed adapters is more valuable than many adapters with weak durability
semantics.

The current quality bar is:

- Postgres is the reference SQL adapter.
- Cloudflare D1 is the first non-Postgres pressure test.
- Host adapters wake the runtime; they do not own workflow state.
- Store adapters own their persistence schema/resources and publish setup and
  migration artifacts.
- Core stays headless and only depends on the `WorkflowExecutionStore` contract.

## Prove the Shape First

Before adding many more adapters, harden these areas:

| Area | What right means |
| --- | --- |
| Store contract | Covers leases, timers, schedules, signals, approvals, replay, idempotency, pagination, and stale recovery without adapter-specific hacks. |
| Migration ownership | Package-owned artifacts work in real app deploys. Apps do not mirror `workflow_*` internals. |
| Host wakeups | Cron, scheduled functions, worker alarms, and background routes wake bounded sweeps predictably. |
| Backpressure | Sweeps stay bounded when many timers or schedules are due. |
| Observability | Users can answer what ran, what is stuck, what is due, and what failed. |
| Upgrade story | Package versions clearly map to required store migrations. |
| Dogfood | TanStack.com or another real app runs the adapter under real deploy constraints. |

## Near-Term Order

1. Harden `@tanstack/workflow-store-drizzle-postgres`.
   - It is the reference adapter.
   - Every future store should pass the same contract suite.
   - Dogfood it in TanStack.com until migrations, sweeps, schedules, and
     recovery feel routine.

2. Use `@tanstack/workflow-store-cloudflare-d1` as the non-Postgres pressure
   test.
   - D1 forces SQLite semantics, no `FOR UPDATE SKIP LOCKED`, Cloudflare Worker
     constraints, and Wrangler migration ergonomics.
   - Deploy a small Cloudflare Worker demo with Cron Trigger + D1.

3. Expand the contract suite before adding more stores.
   - Schedule claiming with old started buckets.
   - Timer claim limits and backpressure.
   - Stale lease recovery.
   - Duplicate signals and approvals.
   - Append conflict behavior.
   - List/timeline pagination.
   - Schema migration artifact checks.
   - Bounded sweep behavior under load.

4. Write `packages/workflow-runtime/ADAPTER_AUTHORING.md` once Postgres and D1
   have settled.
   - Required atomic operations.
   - Acceptable eventual-consistency caveats.
   - Migration artifact requirements.
   - Contract test requirements.
   - Production caveats each adapter must document.

## Future Adapter Order

After Postgres and D1 survive real deployment:

1. `@tanstack/workflow-node`
   - Long-running worker/sweeper helpers for Railway, Fly, Docker, and
     self-hosted Node.

2. `@tanstack/workflow-store-libsql`
   - Reuse the SQLite/D1 lessons.
   - Validate whether a shared SQLite store base is worth extracting.

3. `@tanstack/workflow-store-redis`
   - Requires careful Lua/atomic script design for claims, leases, idempotency,
     timers, and schedule buckets.
   - Do not rush this one; Redis will reveal weak store-contract assumptions.

4. Cloudflare Queues wakeup support.
   - Useful for draining backlogs and improving timer latency beyond pure cron.

5. AWS/DynamoDB/MySQL/GCP adapters.
   - Add only when there is demonstrated demand or dogfood pressure.

## Partner Priority

Prefer partner-native documentation and feature polish in this order:

1. Cloudflare
2. Railway
3. Netlify
4. Vercel compatibility without preferential treatment

## Release Discipline

Any durable store adapter that changes schema, key layout, migration helpers, or
atomic behavior needs a changeset.

Production docs should always say:

- apply adapter-owned migrations before deploying the matching adapter version
- keep `ensureSchema()` for tests, local demos, and explicit admin/bootstrap
  scripts
- never create schema from request handlers, cron ticks, scheduled functions, or
  sweeps

## Decision Rule

Do not add another durable store adapter until at least one existing deployed
adapter has made the missing requirement obvious.

When in doubt, improve the contract suite, docs, dogfood demo, and observability
before adding a new package.
