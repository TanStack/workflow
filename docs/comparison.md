---
title: Comparison | TanStack Workflow
toc: false
---

Choosing a durable workflow engine is mostly a question of where you want the
durability boundary to live. Some products give you a managed control plane.
TanStack Workflow gives you a headless TypeScript engine and lets you choose the
runtime, store, scheduler, and deployment target.

This comparison is a snapshot of how TanStack Workflow fits against the workflow
systems teams commonly evaluate. It focuses on product shape and operational
trade-offs, not every feature or pricing detail. If you use one of these systems
and see something that should be corrected, please suggest a change with notes or
source links.

| Product / library            | Form factor                                              | Programming model                                                                       | Persistence boundary                                                                                       | Long waits / timers                                                                            | Schedules / cron                                                                  | Versioning story                                                                            | Portability                                                                  | TanStack positioning                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TanStack Workflow today**  | Headless TypeScript library plus experimental runtime/store/host adapters. | `createWorkflow` + explicit `ctx.step`, `ctx.sleep`, `ctx.waitForEvent`, `ctx.approve`. | Core `RunStore`, plus runtime `WorkflowExecutionStore`; in-memory and Drizzle/Postgres implementations exist. | Runtime records deadlines, stores timer indexes, and resumes due timers through bounded sweeps. | Runtime schedules materialize due buckets; Vercel and Netlify adapters provide host cron wake-ups. | Explicit `version` + `previousVersions` routes paused runs to old handlers. | High. Runs anywhere a JS function plus durable store can run. | Strongest when users want TanStack-style headless primitives, framework portability, and control over persistence. Devtools/admin UX remains the biggest missing production surface. |
| **TanStack Workflow target** | Headless core plus optional capability packages.         | Same userland API, with adapters for stores/timers/schedules/queues/devtools.           | Postgres/Cloudflare/Redis store adapters with query, timer, lease, schedule, and retention extensions.     | Timer driver claims due timers, reschedules bounded queue wakeups, handles leases/idempotency. | Schedule records with overlap, catchup/backfill, pause/resume, manual trigger.    | Manifest/drain tooling, replay tests, version visibility.                                   | High. Same workflow code across Vercel, Netlify, Cloudflare, Node, AWS, etc. | The portable alternative to managed workflow clouds. Core stays small; production surface comes from capability packages.                                                                    |
| **Vercel Workflow / WDK**    | Managed Vercel platform plus open SDK/world abstraction. | `"use workflow"` / `"use step"` directives and WDK APIs.                                | Vercel managed persistence for state/event logs on Vercel; swappable worlds in WDK.                        | Built-in sleep for minutes/months; likely persisted deadlines plus bounded queue wakeups.      | Platform/SDK-managed patterns; Vercel Cron remains available for route schedules. | Managed platform handles deployments; upgradeable workflow story still a key area to watch. | Medium. WDK has worlds, but Vercel Workflow value is Vercel-managed.         | Best native Vercel choice. TanStack should compare against it, not depend on it.                                                                                                             |
| **Netlify Async Workloads**  | Managed Netlify extension.                               | `asyncWorkloadFn`, events, `step.run`, sleeps/retries.                                  | Netlify-managed internal functions/blobs/workload data.                                                    | Built-in sleep/retry/event behavior.                                                           | Event/workload-driven; Scheduled Functions remain separate platform cron.         | Netlify deploy/function model; product-managed workload lifecycle.                          | Low to medium. Netlify-oriented product.                                     | Best native Netlify managed workflow option. TanStack should provide side-by-side demo and portable alternative.                                                                             |
| **Temporal**                 | Dedicated workflow server/control plane plus workers.    | Deterministic workflow code + Activities, Signals, Queries, Updates.                    | Temporal event history in Temporal service/database.                                                       | First-class durable timers.                                                                    | First-class Schedules with overlap, catchup, pause/resume, backfill.              | Mature patching, Worker Versioning, Continue-As-New.                                        | Medium. Portable infra, but you operate/adopt Temporal.                      | Gold standard for control-plane depth. TanStack should not copy server weight, but should learn from schedule/version/history semantics.                                                     |
| **Inngest**                  | Managed/serverless event workflow platform.              | Event-triggered functions with durable `step.*` APIs.                                   | Inngest managed history/state.                                                                             | `step.sleep`, `step.sleepUntil`, `step.waitForEvent`.                                          | First-class cron/event triggers.                                                  | Platform-managed function version/deploy behavior.                                          | Medium. Framework integrations, but platform-bound.                          | Closest serverless DX benchmark. TanStack can compete on headless portability and local ownership.                                                                                           |
| **Trigger.dev**              | Managed/self-hostable background task platform.          | Tasks, waits, queues, schedules.                                                        | Trigger managed/self-hosted task run state.                                                                | Durable waits release concurrency.                                                             | First-class scheduled tasks and dynamic schedules.                                | Task runs are version locked; replay semantics are explicit.                                | Medium. Self-hostable, but task platform model.                              | Strong benchmark for task ops UX: queues, schedules, replay, idempotency, dashboard.                                                                                                         |
| **DBOS**                     | Library/runtime backed by Postgres.                      | Decorators / workflow functions / queues.                                               | Postgres system database.                                                                                  | Durable sleep in database.                                                                     | Database-backed schedules with pause/resume/backfill/manual trigger.              | Recovery/drain guidance around workflow code changes.                                       | High if Postgres is acceptable.                                              | Closest persistence architecture benchmark for TanStack's first production store adapter.                                                                                                    |
| **Restate**                  | Service/runtime for durable service handlers.            | Handlers, virtual objects, workflows, durable `ctx.run`.                                | Restate server journal.                                                                                    | Durable timers and delayed messages.                                                           | User-built recurrence through delayed sends or external schedulers.               | Immutable deployments/endpoints; existing invocations stay on original deployment.          | Medium. Requires Restate server.                                             | Strong benchmark for normal-service-handler ergonomics and deployment routing.                                                                                                               |
| **Cloudflare Workflows**     | Cloudflare-managed workflow product.                     | Worker workflow classes, steps, sleeps, events.                                         | Cloudflare managed workflow state.                                                                         | Built-in sleep/retry/waitForEvent.                                                             | Cron Triggers can start workflows.                                                | Cloudflare deployment model.                                                                | Low to medium. Cloudflare-oriented.                                          | Good Cloudflare-native comparison; TanStack can run on Workers with DO/D1 store without adopting Cloudflare Workflows.                                                                       |
| **AWS Step Functions**       | Managed state machine service.                           | JSON/YAML or SDK-defined state machines.                                                | AWS managed execution history.                                                                             | Wait states and callback tokens.                                                               | EventBridge/Scheduler starts executions.                                          | Versions/aliases and redrive.                                                               | Low to medium. AWS-native.                                                   | Enterprise/serverless baseline. TanStack wins on TypeScript-library ergonomics; Step Functions wins on managed AWS control plane.                                                            |

## How to read this

TanStack Workflow is intentionally smaller than managed workflow platforms. The
core engine handles deterministic replay, durable steps, pauses, signals,
approvals, and version routing. It does not try to own your deployment target,
database, cron system, queue, or dashboard.

That split is the point:

- If you want a managed platform with an included control plane, Temporal,
  Inngest, Trigger.dev, Vercel Workflow, Netlify Async Workloads, Cloudflare
  Workflows, or AWS Step Functions may be the right fit.
- If you want a TypeScript workflow engine that can run inside your app, on your
  chosen host, against your chosen durable store, TanStack Workflow is the
  headless option.
- For production, the important follow-up pieces are durable store adapters,
  timer drivers, schedule records, queue/concurrency helpers, and devtools.

## Closest competitor: Vercel Workflow

Vercel Workflow is the closest direct competitor for serverless TypeScript apps.
It has a similar developer promise: write normal async TypeScript, split durable
work into steps, sleep without consuming compute, resume from external events,
and let the platform handle persistence and replay.

The difference is the product boundary.

| Question | Vercel Workflow / WDK | TanStack Workflow |
| --- | --- | --- |
| What do you adopt? | A managed Vercel workflow platform, powered by WDK, Vercel Functions, Vercel Queues, and Vercel-managed persistence. | A headless TypeScript engine inside your app, plus whichever store/timer/schedule adapters you choose. |
| How do you mark durable code? | Directive model: `"use workflow"` and `"use step"`. | Explicit API model: `createWorkflow`, `ctx.step`, `ctx.sleep`, `ctx.waitForEvent`, `ctx.approve`. |
| Where does persistence live? | On Vercel, state and event logs live in Vercel-managed persistence. WDK also has swappable "worlds" such as Postgres for self-hosting. | In a `RunStore` you own or configure. The event log, run state, timer index, and schedule records are part of the adapter contract. |
| Who owns timers? | Vercel Workflow owns the timer system. Long sleeps likely combine persisted deadlines with bounded queue wakeups. | Core records the deadline. A timer driver/store adapter claims due timers and resumes runs. |
| Who owns operations UI? | Vercel dashboard and Workflow observability. | TanStack devtools/admin APIs are planned capability packages. |
| Best fit | Teams already deploying on Vercel that want the managed workflow product and do not mind the Vercel runtime boundary. | Teams that want durable workflows to stay part of their app architecture and remain portable across Vercel, Netlify, Cloudflare, Node, AWS, and custom infrastructure. |

So the positioning is not "TanStack Workflow works on Vercel and Vercel
Workflow doesn't." Vercel owns the Vercel-native experience.

The positioning is:

> Use Vercel Workflow when you want Vercel to be the workflow platform. Use
> TanStack Workflow when you want durable execution as an app-embedded, explicit,
> storage-adapter-driven TanStack primitive.

## Current recommendation

For production-style TanStack Workflow deployments, use a durable store as the
system boundary. Postgres is the best first target because it can hold run state,
the append-only event log, due-timer indexes, schedule records, leases, run
search indexes, and retention policies in one portable substrate.

On serverless hosts like Vercel and Netlify, provider cron or scheduled functions
should wake bounded timer sweeps. The database decides whether a workflow is
actually due to resume.
