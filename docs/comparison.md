---
id: comparison
title: Comparison
toc: false
---

Choosing a durable workflow engine is mostly a question of where you want the
durability boundary to live. Some products give you a managed control plane.
TanStack Workflow gives you a headless TypeScript engine and lets you choose the
runtime, store, scheduler, and deployment target.

This comparison shows how TanStack Workflow fits against the workflow systems
teams commonly evaluate. It focuses on product shape and operational trade-offs,
not every feature or pricing detail. If you use one of these systems and see
something that should be corrected, please suggest a change with notes or source
links.

## Capability matrix

Legend: ✅ first-class fit, 🟡 possible or partial fit, 🔴 not a primary fit.
The TanStack signal column explains whether the row is a differentiator, table
stakes, or an area where competitors set the bar we need to meet.
This matrix compares product fit, not identical APIs. When public documentation
does not clearly support a first-class claim, the cell is marked partial.

| Capability | TanStack signal | TanStack Workflow | Vercel Workflow / WDK | Netlify Async Workloads | Temporal | Inngest | Trigger.dev | DBOS | Restate | Cloudflare Workflows | AWS Step Functions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Headless library embedded in your app | Differentiator | ✅ | 🟡 | 🔴 | 🔴 | 🔴 | 🔴 | ✅ | 🟡 | 🔴 | 🔴 |
| Bring your own durable store | Differentiator | ✅ | 🟡 | 🔴 | 🟡 | 🔴 | 🟡 | ✅ | 🔴 | 🔴 | 🔴 |
| No required external service | Differentiator | ✅ | 🔴 | 🔴 | 🔴 | 🔴 | 🟡 | ✅ | 🔴 | 🔴 | 🔴 |
| Runs across Vercel, Netlify, Cloudflare, Node, AWS | Differentiator | ✅ | 🟡 | 🔴 | 🟡 | ✅ | 🟡 | 🟡 | 🟡 | 🔴 | 🔴 |
| Plain TypeScript workflow authoring | Table stakes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🟡 |
| Explicit durable steps | Table stakes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Durable sleep / timers | Table stakes | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Wait for external events | Table stakes | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ |
| Human approval gates | Catch up to Temporal-style workflows | ✅ | 🟡 | 🟡 | ✅ | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 | 🟡 |
| Recurring schedules / cron | Table stakes | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | 🟡 | 🟡 | ✅ |
| Schedule pause/resume/backfill controls | Catch up to Temporal, Inngest, Trigger.dev, DBOS | 🟡 | 🟡 | 🔴 | ✅ | ✅ | 🟡 | ✅ | 🟡 | 🔴 | 🟡 |
| Durable queues / concurrency controls | Catch up to managed task platforms | 🟡 | ✅ | 🟡 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Version routing for paused runs | Catch up to Temporal, Trigger.dev, Restate | ✅ | 🟡 | 🟡 | ✅ | 🟡 | ✅ | 🟡 | ✅ | 🟡 | ✅ |
| Run search, replay, retry, and retention operations | Catch up to mature control planes | 🟡 | 🟡 | 🟡 | ✅ | ✅ | ✅ | 🟡 | 🟡 | ✅ | ✅ |
| Devtools / dashboard included | Catch up to managed platforms, TanStack-style | 🟡 | ✅ | 🟡 | ✅ | ✅ | ✅ | 🟡 | ✅ | ✅ | ✅ |
| Managed control plane included | Intentional non-goal | 🔴 | ✅ | ✅ | 🟡 | ✅ | ✅ | 🔴 | 🟡 | ✅ | ✅ |

## Product shape

| Product / library | Form factor | Programming model | Persistence boundary | Portability | Best fit |
| --- | --- | --- | --- | --- | --- |
| **TanStack Workflow** | Headless core plus optional capability packages for stores, timers, schedules, queues, and devtools. | `createWorkflow` + explicit `ctx.step`, `ctx.sleep`, `ctx.waitForEvent`, `ctx.approve`. | A `WorkflowStore` you own or configure. Store adapters provide event logs, run state, timer indexes, schedule records, leases, search indexes, and retention. | High. Same workflow code across Vercel, Netlify, Cloudflare, Node, AWS, and custom infrastructure. | Teams that want TanStack-style primitives, app-embedded durable execution, framework portability, and control over persistence. |
| **Vercel Workflow / WDK** | Managed Vercel platform plus open SDK/world abstraction. | `"use workflow"` / `"use step"` directives and WDK APIs. | Vercel managed persistence for state/event logs on Vercel; swappable worlds in WDK. | Medium. WDK has worlds, but Vercel Workflow value is Vercel-managed. | Best native Vercel choice when you want Vercel to own the workflow platform. |
| **Netlify Async Workloads** | Managed Netlify extension. | `asyncWorkloadFn`, events, `step.run`, sleeps/retries. | Netlify-managed internal functions/blobs/workload data. | Low to medium. Netlify-oriented product. | Best native Netlify choice when you want Netlify to own the workload platform. |
| **Temporal** | Dedicated workflow server/control plane plus workers. | Deterministic workflow code + Activities, Signals, Queries, Updates. | Temporal event history in Temporal service/database. | Medium. Portable infrastructure, but you operate or adopt Temporal. | Teams that want the deepest mature workflow control plane. |
| **Inngest** | Managed/serverless event workflow platform. | Event-triggered functions with durable `step.*` APIs. | Inngest managed history/state. | Medium. Framework integrations, but platform-bound. | Serverless event workflows with strong managed DX. |
| **Trigger.dev** | Managed/self-hostable background task platform. | Tasks, waits, queues, schedules. | Trigger managed/self-hosted task run state. | Medium. Self-hostable, but task-platform oriented. | Background jobs, queues, schedules, replays, and operational task UX. |
| **DBOS** | Library/runtime backed by Postgres. | Decorators / workflow functions / queues. | Postgres system database. | High if Postgres is acceptable. | Teams that want Postgres to be the system boundary. |
| **Restate** | Service/runtime for durable service handlers. | Handlers, virtual objects, workflows, durable `ctx.run`. | Restate server journal. | Medium. Requires Restate server. | Durable service handlers and virtual-object style application architecture. |
| **Cloudflare Workflows** | Cloudflare-managed workflow product. | Worker workflow classes, steps, sleeps, events. | Cloudflare managed workflow state. | Low to medium. Cloudflare-oriented. | Cloudflare-native durable workflows. |
| **AWS Step Functions** | Managed state machine service. | JSON/YAML or SDK-defined state machines. | AWS managed execution history. | Low to medium. AWS-native. | Enterprise/serverless workflows inside AWS. |

## How to read this

TanStack Workflow is intentionally smaller than managed workflow platforms. The
core engine handles deterministic replay, durable steps, pauses, signals,
approvals, and version routing. Capability packages provide production store,
timer, schedule, queue, host, and devtools integrations without making the core
engine own your deployment target, database, cron system, queue, or dashboard.

That split is the point:

- If you want a managed platform with an included control plane, Temporal,
  Inngest, Trigger.dev, Vercel Workflow, Netlify Async Workloads, Cloudflare
  Workflows, or AWS Step Functions may be the right fit.
- If you want a TypeScript workflow engine that can run inside your app, on your
  chosen host, against your chosen durable store, TanStack Workflow is the
  headless option.
- The production surface is assembled from capability packages: durable store
  adapters, timer drivers, schedule records, queue/concurrency helpers, host
  adapters, and devtools.

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
