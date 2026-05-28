# Vercel and Netlify native provider investigation

Date: 2026-05-25

Scope: whether Vercel and Netlify provide enough native deployment primitives to
host TanStack Workflow well, and whether their native workflow systems should be
treated as adapters, substrates, competitors, or demos.

## Bottom line

Vercel and Netlify both now have workflow-shaped platform products, not just
functions plus cron. That changes the docs story:

- Vercel has **Vercel Workflow** in beta, built on Workflow Development Kit
  (WDK), plus **Vercel Queues**. This is a direct managed competitor to TanStack
  Workflow, not merely deployment plumbing. Use it as a comparison target. Do not
  build TanStack Workflow on top of Vercel Workflow unless we are intentionally
  writing a WDK interop layer.
- Netlify has **Async Workloads**, which is also a durable workflow product, plus
  **Netlify Database** as native Postgres. Async Workloads is a comparison target.
  Netlify Database is a realistic native `RunStore` substrate.
- The best headless TanStack story for both providers is still:
  `Fetch/HTTP route handler + external durable RunStore + provider cron/schedule`
  for timer sweeps and recurring fresh runs.
- The first serious provider-native storage adapter should be Postgres, because
  it covers Vercel Marketplace Postgres, Netlify Database, Neon, Supabase, local
  dev, and non-serverless Node workers with one implementation.
- Vercel Queues are useful for short-delay delivery and durable webhook/event
  ingestion, but their documented 24-hour max retention/delay means they are not
  enough for month-scale sleeps by themselves.
- Vercel Workflow almost certainly bridges that queue limit with a persisted
  target deadline and repeated shorter wakeups. The public docs do not specify
  the exact cadence, but Vercel documents both that Queues max out at 24-hour
  retention/delay and that Workflow can sleep for minutes or months. The only
  viable architecture is a timer record in managed persistence plus
  re-enqueue/reschedule until the deadline is due.
- Netlify Blobs should not be the primary `RunStore`. They are useful for blobs
  or low-write metadata, but the docs explicitly describe last-write-wins writes
  and no built-in concurrency control. TanStack Workflow needs CAS append.

## Native capability matrix

| Capability              | Vercel native                                                                                                                                                              | Netlify native                                                                                                                                  | TanStack implication                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| HTTP ingress            | Vercel Functions / Next route handlers.                                                                                                                                    | Netlify Functions.                                                                                                                              | A generic Fetch handler should cover both.                                                                                  |
| Request after-work      | `waitUntil()` / Next `after()`, but bounded by function timeout.                                                                                                           | Background Functions can run async up to 15 minutes.                                                                                            | Helpful for short side effects only; not workflow durability.                                                               |
| Cron / scheduled ticks  | Vercel Cron sends HTTP GET to production route. UTC only, no retry, duplicate delivery possible, overlap possible.                                                         | Scheduled Functions run by cron in UTC, 30-second limit, published deploys only, no direct production URL.                                      | Good timer/schedule wake mechanism, but the workflow store must handle idempotency and locks.                               |
| Native durable workflow | Vercel Workflow beta, backed by Functions, Queues, managed persistence, WDK directives.                                                                                    | Async Workloads extension: durable, event-driven, multi-step, retries, sleep.                                                                   | Treat as competitors or side-by-side demos, not substrates for core.                                                        |
| Queue                   | Vercel Queues beta: append-only topics, at-least-once delivery, leases, idempotency key, 24-hour TTL/delay.                                                                | Async Workloads internal event router; no separate general queue primitive in the same shape.                                                   | Vercel Queues can be an optional event ingress/short-delay adapter. Not enough for long sleeps.                             |
| Durable store           | Vercel Blob, Edge Config, Marketplace Postgres/KV/NoSQL. No generic first-party CAS run log store except Workflow's managed internal persistence.                          | Netlify Database built-in Postgres; Netlify Blobs with eventual/strong consistency but last-write-wins and no concurrency control.              | Postgres adapter is the right shared target. Avoid Blob/Edge Config for event logs.                                         |
| Version/deploy behavior | Deployments are immutable; Skew Protection pins client/server requests for supported frameworks, but it is not workflow version drain. Cron rollback behavior has caveats. | Functions are version-controlled with deploys; scheduled functions only run on published deploys; Netlify Database branches per deploy preview. | `previousVersions` and drain tooling still required. Provider skew features do not solve paused workflow code reachability. |
| Observability           | Vercel Workflow has built-in workflow observability. Vercel Queues exposes queue observability. Cron/function logs exist.                                                  | Functions UI/logs, Observability, Async Workloads lifecycle, Blobs UI, Database dashboard.                                                      | TanStack still needs run-level devtools/admin APIs for portable mode.                                                       |
| Local dev               | Cron jobs are plain routes but Vercel docs state no cron support in dev servers.                                                                                           | Scheduled Functions can be invoked locally, but Netlify Dev does not run them on a schedule.                                                    | Provide manual local sweep routes and fake timer tests.                                                                     |

## Persistence comparison

| Substrate                                    | Durable state                                 | Append-only CAS event log                                     | Timer index / long sleep                                                              | Query/search runs                             | Portability                               | Recommendation                                                                   |
| -------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| Vercel Workflow managed persistence          | Yes, managed by Vercel Workflow.              | Yes, internal to Vercel Workflow.                             | Yes, internal. Long sleeps likely use persisted deadlines plus bounded queue wakeups. | Vercel dashboard/API surface, not portable.   | Vercel-only.                              | Treat as a managed competitor/comparison demo, not the TanStack substrate.       |
| Vercel Queues                                | Message payloads only, max 24-hour retention. | No. Queues are delivery, not workflow history.                | Short delays only; not enough for month-scale sleeps by itself.                       | Queue observability, not workflow run search. | Vercel-only.                              | Optional short-delay/event-ingress adapter. Do not use as primary persistence.   |
| Vercel Marketplace Postgres / Neon           | Yes.                                          | Yes, with transaction/CAS schema.                             | Yes, with indexed `wakeAt` rows and leases.                                           | Yes, via SQL indexes.                         | High. Same adapter works outside Vercel.  | Best production substrate for TanStack on Vercel.                                |
| Vercel Blob / Edge Config                    | Blob/config state only.                       | No practical CAS append log.                                  | No durable timer semantics.                                                           | Weak for workflow queries.                    | Vercel-only.                              | Use for claim-check payloads or config, not run history.                         |
| Netlify Async Workloads internal persistence | Yes, managed by Async Workloads.              | Yes, internal to Async Workloads.                             | Yes, internal sleep support.                                                          | Netlify product surface, not portable.        | Netlify-only.                             | Treat as a managed competitor/comparison demo, not the TanStack substrate.       |
| Netlify Database / Postgres                  | Yes.                                          | Yes, with transaction/CAS schema.                             | Yes, with indexed `wakeAt` rows and leases.                                           | Yes, via SQL indexes.                         | High. Same adapter works outside Netlify. | Best production substrate for TanStack on Netlify.                               |
| Netlify Blobs                                | Object/blob state.                            | No. Docs describe last-write-wins and no concurrency control. | No durable timer semantics.                                                           | Weak for workflow queries.                    | Netlify-only.                             | Use for large payload claim checks, attachments, or archived logs only.          |
| External Redis / Upstash                     | Yes for simple state.                         | Possible, but CAS/stream/index design matters.                | Possible with sorted sets and leases.                                                 | Moderate; secondary indexes must be designed. | Medium. Works on both providers.          | Good POC/secondary adapter, but Postgres is the cleaner first production target. |

## Vercel assessment

### What Vercel provides natively

1. **Vercel Workflow**

   Vercel Workflow is beta on all plans and is built on WDK. Vercel says it
   manages Functions execution, Queues, and managed persistence for state/event
   logs. It supports durable workflows, steps, sleep, hooks for external events,
   and dashboard observability.

   This is the native Vercel answer to long-lived workflows. It is also the
   clearest direct comparison to TanStack Workflow.

2. **Vercel Queues**

   Queues are beta and expose a durable event streaming system with topics,
   consumer groups, at-least-once delivery, visibility timeouts, delayed
   delivery, idempotency keys, retries, max concurrency, push mode, and poll
   mode. They are lower-level than Vercel Workflow.

   Key limitation for TanStack Workflow timers: the Queues API documents message
   retention max 24 hours, delayed visibility cannot exceed retention, and
   visibility timeout max 60 minutes. That is excellent for short background
   dispatch and webhook fan-in. It is not sufficient for "sleep for 30 days"
   without another durable timer table.

   Vercel Workflow's own `sleep('7 days')`/months-scale behavior should be read
   as "managed workflow persistence plus queue wakeups," not as "Vercel Queues
   can natively delay one message for months." For TanStack, the equivalent
   portable design is to persist `wakeAt`, enqueue or cron-sweep at bounded
   intervals, and resume only when `now >= wakeAt`.

3. **Vercel Cron**

   Cron calls a production deployment URL with HTTP GET. It is UTC. The docs
   recommend `CRON_SECRET` for route auth, explicitly say cron invocations are
   not retried on failure, and call out overlap/duplicate delivery/idempotency.
   Hobby plans have daily-only cron restrictions and looser execution accuracy.

4. **Vercel Functions and `waitUntil`**

   Function duration is bounded. `waitUntil()`/Next `after()` can run after a
   response, but promises have the same timeout as the function and are canceled
   if the function times out. This is not a durable workflow mechanism.

5. **Storage**

   Vercel's first-party storage products are Blob and Edge Config. The storage
   overview points users to Marketplace providers for Postgres, Redis/KV, NoSQL,
   vector, etc. For TanStack Workflow, Marketplace Postgres or Redis is the
   realistic durable store path.

### Recommended TanStack Vercel guide shape

Ship two distinct pages:

1. **TanStack Workflow on Vercel**
   - Next route handler or Vercel Function as workflow HTTP ingress.
   - `@tanstack/workflow-store-postgres` using Vercel Marketplace Postgres/Neon,
     or Redis/Upstash as a secondary POC option.
   - Vercel Cron route for `sweepDueTimers()`.
   - Separate cron route for recurring schedules.
   - `CRON_SECRET` auth example.
   - Explicit idempotency and overlap handling.
   - A note that Vercel Queues can deliver external events or short delays, but
     month-scale timers still need the durable run/timer store.
   - A deploy/version section explaining that `previousVersions` is still needed.

2. **TanStack Workflow vs Vercel Workflow**
   - Vercel Workflow is managed and tightly integrated with Vercel.
   - TanStack Workflow is portable/headless and can use any store/host.
   - WDK directives (`"use workflow"`, `"use step"`) are a different programming
     model from TanStack's explicit `createWorkflow`/`ctx.step`.
   - If users already want a Vercel-only managed solution, Vercel Workflow may be
     the platform-native choice. If they want portability, TanStack should be the
     choice.

### Vercel POC improvements

The existing Vercel POC proves route handler + cron + external store. To make it
provider-native, add:

- A Vercel Marketplace Postgres/Neon-backed `RunStore` option.
- A short-delay Vercel Queues demo that publishes a signal event to a private
  queue consumer, then resumes the workflow. Do not use Queues as the only timer
  system for sleeps beyond 24 hours.
- A duplicate cron delivery test and an overlap lock test.
- A paused-run version upgrade test:
  1. start v1
  2. pause on sleep/event
  3. deploy v2 with `previousVersions([v1])`
  4. resume
- A "Vercel Workflow comparison" example using the same fulfillment flow in WDK,
  clearly marked as comparison, not TanStack runtime.

## Netlify assessment

### What Netlify provides natively

1. **Netlify Async Workloads**

   Async Workloads is a durable, event-driven workload extension. It supports
   multi-step workloads, retries, sleep, event sending, lifecycle concepts, and
   an internal router. The docs say it provisions serverless functions and blobs
   internally and uses existing serverless resources.

   This is Netlify's workflow competitor. It should be a comparison target, not
   the default substrate for TanStack Workflow.

2. **Netlify Scheduled Functions**

   Scheduled Functions run cron-like tasks in UTC. They have a 30-second
   execution limit, only run on published deploys, cannot be invoked directly by
   URL in production, and do not support payloads/POST. They are useful for timer
   sweeps if each sweep is bounded and idempotent.

3. **Netlify Background Functions**

   Background Functions are queued asynchronous functions that run up to 15
   minutes and return 202 immediately. They retry after one minute and two
   minutes on invocation errors. Useful for longer single invocations, but not
   month-scale workflow suspension.

4. **Netlify Database**

   Netlify Database is built-in managed Postgres with deploy preview branching
   and migrations. This is the strongest native building block for a TanStack
   Workflow `RunStore` on Netlify.

5. **Netlify Blobs**

   Blobs are a convenient site-scoped store and can opt into strong reads, but
   writes are last-write-wins and the docs say there is no concurrency control.
   That makes Blobs a poor fit for the append-only CAS event log. They can store
   large payload claim checks, attachments, or exported histories, not the primary
   event log.

### Recommended TanStack Netlify guide shape

Ship two distinct pages:

1. **TanStack Workflow on Netlify**
   - Netlify Function as workflow HTTP ingress.
   - Netlify Database/Postgres `RunStore`.
   - Scheduled Function for due-timer sweep.
   - Separate Scheduled Function for recurring fresh workflow runs.
   - Manual debug route for local/prod smoke tests because scheduled functions
     are not directly URL-invokable in production.
   - Keep timer sweep under 30 seconds by batching and leasing.
   - Optional Background Function for expensive post-resume work, but clarify
     that durable workflow state still lives in the store.

2. **TanStack Workflow vs Netlify Async Workloads**
   - Async Workloads is managed and event-driven inside Netlify.
   - TanStack Workflow is host/store portable.
   - Async Workloads has its own `asyncWorkloadFn` and `step.run` model.
   - If users only target Netlify and want the managed extension, Async Workloads
     is the native choice. If they want library portability and a shared API
     across Vercel/Netlify/Cloudflare/Node, use TanStack Workflow.

### Netlify POC improvements

The existing Netlify POC proves functions + scheduled functions + external
store. To make it provider-native, add:

- Netlify Database/Postgres `RunStore`.
- A batched scheduled timer sweep with a lease table.
- A manual `/.netlify/functions/timer-sweep-debug` route for smoke tests,
  separate from the scheduled-only function.
- A Blobs claim-check example for large signal payloads, not for the event log.
- An Async Workloads side-by-side implementation of the same fulfillment flow,
  clearly marked as comparison, not TanStack runtime.
- A deploy-preview note:
  - scheduled functions do not run on deploy previews
  - Netlify Database creates preview branches
  - production workflow runs should not be resumed by preview deploys unless
    explicitly configured

## Adapter strategy

Do not start with `@tanstack/workflow-vercel` or `@tanstack/workflow-netlify`.
Most useful code is not host-specific:

- `@tanstack/workflow-store-postgres`
  - `RunStore`
  - due timer index
  - leases
  - run search
  - schedule records
- `@tanstack/workflow-http`
  - Fetch `Request`/`Response` handler for start/attach/signal
  - works in Vercel, Netlify, Cloudflare, Bun, Node, Deno
- `@tanstack/workflow-timers`
  - `sweepDueTimers({ runStore, workflows, limit, budgetMs })`
  - provider cron invokes this
- `@tanstack/workflow-schedules`
  - fresh invocation per tick
  - overlap/catchup/backfill policies
- `@tanstack/workflow-testing`
  - fake time
  - replay fixture tests
  - scheduler tests

Host-specific helpers should be thin examples or recipes:

- Vercel: `vercel.json` cron config, Next route handler snippets, `CRON_SECRET`,
  optional Vercel Queues event-ingress recipe.
- Netlify: `netlify.toml` scheduled function config, scheduled-only function
  wrapper, manual debug route, Netlify Database setup.

## Provider-native demo checklist

For both Vercel and Netlify, the demos should prove:

1. Start run through native HTTP function.
2. Persist run state/log in provider-native Postgres.
3. Pause on `ctx.sleepUntil`.
4. Wake via provider-native cron/scheduled function.
5. Lease timer before delivery.
6. Deliver duplicate timer and prove idempotency.
7. Pause on `ctx.waitForEvent`.
8. Resume through HTTP/webhook signal with stable `signalId`.
9. Deliver duplicate signal and prove idempotency.
10. Run a recurring scheduled workflow as fresh invocations.
11. Prevent or explicitly allow overlapping scheduled ticks.
12. Resume a paused run after a deployment using `previousVersions`.
13. Show run status/log/deadline/version through a JSON admin route.
14. Compare with the provider's native workflow product using the same scenario.

## Recommendation

Build provider-native demos in this order:

1. **Postgres store package/demo**: one implementation that works on Vercel
   Marketplace Postgres and Netlify Database.
2. **Timer sweep leases**: same code invoked by Vercel Cron and Netlify Scheduled
   Functions.
3. **Vercel Queues short-delay/event-ingress demo**: useful, but limited to
   queue retention windows.
4. **Netlify Async Workloads comparison demo**: side-by-side, not adapter.
5. **Vercel Workflow comparison demo**: side-by-side, not adapter.

This keeps TanStack Workflow headless while still answering provider-native
questions honestly. We can say:

> TanStack Workflow runs natively on Vercel and Netlify Functions, but its
> durability boundary is the store. Use Postgres for production, provider cron
> for wakeups, and optional provider queues for short async delivery. Provider
> workflow products are alternatives, not required dependencies.

## Sources

Vercel:

- <https://vercel.com/docs/workflows>
- <https://vercel.com/docs/queues>
- <https://vercel.com/docs/queues/api>
- <https://vercel.com/docs/cron-jobs>
- <https://vercel.com/docs/cron-jobs/manage-cron-jobs>
- <https://vercel.com/docs/functions/configuring-functions/duration>
- <https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package>
- <https://vercel.com/docs/storage>
- <https://vercel.com/docs/skew-protection>
- <https://useworkflow.dev/docs/api-reference/workflow>
- <https://useworkflow.dev/docs/api-reference/workflow/sleep>

Netlify:

- <https://docs.netlify.com/build/async-workloads/overview/>
- <https://docs.netlify.com/build/async-workloads/writing-workloads/>
- <https://docs.netlify.com/build/async-workloads/multi-step-workloads/>
- <https://docs.netlify.com/build/async-workloads/sending-events/>
- <https://docs.netlify.com/build/async-workloads/limitations/>
- <https://docs.netlify.com/build/functions/scheduled-functions/>
- <https://docs.netlify.com/build/functions/background-functions/>
- <https://docs.netlify.com/build/functions/overview/>
- <https://docs.netlify.com/build/data-and-storage/netlify-database/>
- <https://docs.netlify.com/build/data-and-storage/netlify-blobs/>
