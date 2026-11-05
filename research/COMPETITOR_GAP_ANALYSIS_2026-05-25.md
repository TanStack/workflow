# Competitor gap analysis - durable workflows

Date: 2026-05-25

Scope: TanStack Workflow long-lived execution, serverless deployment, cron,
timers, external events, versioning, observability, and runtime adapters.

This note is intentionally biased toward blind spots. The deployment POCs already
prove that the headless core can run on Cloudflare, Vercel, and Netlify when a
durable `RunStore` plus timer sweep endpoint exist. The competitor pattern is
that durable execution is only one layer; production systems also need a small
control plane around schedules, timers, queues, versions, and run management.

## Executive takeaways

1. The biggest gap is not workflow syntax. It is the operational surface around
   long-lived runs: list due timers, claim wakeups, list schedules, pause/resume
   schedules, backfill missed ticks, search runs, retry/redrive failed runs, and
   inspect version drain.
2. We should keep the headless shape, but we should name capabilities explicitly.
   Avoid `vercelAdapter`, `netlifyAdapter`, and `cloudflareAdapter`. Prefer
   capability packages like `RunStore`, `TimerDriver`, `ScheduleStore`,
   `ScheduleDriver`, `EventIngress`, and `QueueLimiter`.
3. Scheduling is more than cron strings. Temporal, Trigger.dev, DBOS, and
   Hatchet all expose schedule records that can be listed, updated, paused,
   resumed, deleted, manually triggered, and sometimes backfilled.
4. Timer wakeup needs a real store contract. `RunState.waitingFor.deadline`
   proves the model, but production hosts need a due-timer index, leases,
   duplicate-safe delivery, cancellation of stale timers, and batching.
5. Versioning needs productized deploy guidance. `previousVersions` is the right
   primitive for a library, but users need manifest/drain tooling and docs for
   keeping old code reachable while paused runs resume.
6. Competitors treat paused runs as not consuming concurrency. This should be
   explicit in our queue/concurrency story so long sleeps do not distort capacity
   planning.
7. Event waits need timeout and buffering semantics that are easy to explain.
   The current deadline metadata is enough for hosts to see pending waits, but
   mature systems define what happens when timeouts fire and how early/duplicate
   events are handled.
8. We need docs that say exactly what a provider supplies and what TanStack
   Workflow supplies. On Vercel/Netlify, cron only wakes routes. On Cloudflare,
   Cron Triggers and Durable Objects can provide more of the timer/store surface.
   In all cases, the durable store is the real boundary.

## Product comparison table

This table compares TanStack Workflow itself against the products/libraries users
will naturally evaluate. It is not a raw feature checklist; it is the positioning
view: what users buy into, what they have to operate, and where TanStack needs
supporting packages/docs.

| Product / library            | Form factor                                              | Programming model                                                                       | Persistence boundary                                                                                       | Long waits / timers                                                                            | Schedules / cron                                                                  | Versioning story                                                                            | Portability                                                                  | TanStack positioning                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TanStack Workflow today**  | Headless TypeScript library.                             | `createWorkflow` + explicit `ctx.step`, `ctx.sleep`, `ctx.waitForEvent`, `ctx.approve`. | User-provided `RunStore` with run state + append-only CAS event log. In-memory store ships for tests/POCs. | Core records deadline and pauses. Host/store must provide due-timer index and sweeper.         | External scheduler starts fresh workflow runs. No schedule package yet.           | Explicit `version` + `previousVersions` routes paused runs to old handlers.                 | High. Runs anywhere a JS function plus durable store can run.                | Strongest when users want TanStack-style headless primitives, framework portability, and control over persistence. Needs store/timer/schedule/devtools packages to feel production complete. |
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

## Competitor capability matrix

| Area                       | Mature competitor pattern                                                                                                                                                         | TanStack Workflow today                                                                   | Blind spot / recommendation                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Durable steps              | Plain code with persisted checkpoints or event history. Temporal Activities, Inngest steps, Trigger tasks, Restate `ctx.run`, DBOS steps, Hatchet durable tasks, Dapr activities. | `ctx.step` with append-only log, retries, per-attempt timeout, replay skip.               | Good foundation. Need production store adapters and stronger replay/devtools UX.                               |
| Durable timers             | First-class sleep/timer APIs with a runtime-managed timer queue. Waiting runs do not consume active execution capacity.                                                           | `ctx.sleep` / `ctx.sleepUntil` pause on `__timer` with a deadline in run state.           | Add `TimerDriver` and store methods for due-timer indexing, claim/lease, batch wake, jitter, and cancellation. |
| Recurring schedules        | Independent schedule records with cron/interval, timezone, pause/resume, manual trigger, list/update/delete, overlap policy, catchup/backfill.                                    | Docs recommend external cron plus fresh `runWorkflow` per tick. POC has cron routes.      | Build `@tanstack/workflow-schedules` after a durable store lands. Keep engine unaware.                         |
| External events / signals  | Targeted events to a run; callback tokens; event filters; timeouts; buffering; idempotency.                                                                                       | `ctx.waitForEvent(name, { deadline, schema, meta })` and resume with `signalId`.          | Define timeout behavior, pre-wait event buffering, event query/routing docs, and webhook verification recipes. |
| Human approval             | Usually implemented as external event wait plus dashboard/API affordances. Some AI systems expose suspend/resume directly.                                                        | `ctx.approve` persists approval request/resolution.                                       | Add assignment, ACL, expiration/reminder/escalation docs, and an audit-oriented UI/devtools story.             |
| Concurrency / queues       | Active execution is limited; sleeps and waits release slots. Keys/scopes support per-tenant limits. Rate limits/throttles smooth starts.                                          | No queue package yet. Examples can gate manually with deterministic run IDs.              | Add queue/limiter capability separate from engine. Include per-run, per-step, per-workflow, per-key limits.    |
| Retries / redrive          | Step retries, failure classification, manual replay/redrive, bulk retry/cancel, DLQ or max recovery attempts.                                                                     | Step retry exists. Failed run remains in store until deleted by store policy.             | Add run redrive/retry semantics and admin APIs. Clarify replay with same code version versus latest version.   |
| Versioning / deploy safety | Patching, worker versioning, immutable deployment endpoints, state-machine versions/aliases, side-by-side deployments, version drain metrics.                                     | `version` and `previousVersions` route in-flight runs to old handlers.                    | Add manifest/lock tooling, drain dashboard, deploy docs per provider, and a replay-safety test harness.        |
| History growth             | Continue-as-new, child workflow splits, retention, archive/purge, snapshots.                                                                                                      | Event log grows for the life of a run. No `continueAsNew`.                                | Add compaction story before recommending month/year loops. Prefer fresh scheduled runs and child workflows.    |
| Child workflows / DAGs     | Temporal child workflows, Dapr child workflows, Hatchet child spawning, Step Functions nested/Map/Parallel.                                                                       | No first-class child workflow primitive yet.                                              | Add `ctx.invoke`/child workflow design only after queue/store contracts are stable.                            |
| Observability              | Dashboard with run list/search, statuses, timeline, logs/traces, metrics, audit events, schedule state, queued backlog.                                                           | Unified event log can power a UI; no packaged UI/control API yet.                         | Devtools/admin API is a core adoption requirement, even if optional.                                           |
| Local testing              | Fake time, replay tests, local dashboard/dev server, deterministic history fixtures.                                                                                              | Vitest examples and in-memory store.                                                      | Add `testWorkflow`, fake timer driver, replay from fixture, and schedule/timer test utilities.                 |
| Security / tenancy         | Authenticated webhooks, scoped tokens, payload redaction, encryption, RBAC, audit logs.                                                                                           | Core is storage-agnostic. POCs intentionally use a public Cloudflare store as a shortcut. | Production docs must make store auth, signed ingress, secrets, and payload policy explicit.                    |

## Competitor notes

### Temporal

Temporal is the broadest control-plane benchmark.

- Schedules are independent resources that start workflow executions. The docs
  distinguish schedules from older cron jobs and include interval/calendar specs,
  time bounds, exclusions, jitter, time zones, pause, backfill, overlap policy,
  catchup window, pause-on-failure, and last completion/failure data.
- Message passing is first-class. Workflows expose Queries, Signals, and Updates,
  so a workflow can behave like a stateful service.
- Continue-As-New is the answer for history growth. It closes one execution and
  creates a new run in the same chain with fresh history.
- Versioning has two major tracks: patch branches inside code and worker
  versioning/deployment routing so old executions continue on compatible code.

TanStack implication: do not copy Temporal's server requirement, but do copy the
surface area users expect: schedules as records, visibility, history limits,
version-drain guidance, and message semantics.

Primary docs:

- <https://docs.temporal.io/schedule>
- <https://docs.temporal.io/develop/typescript/workflows/message-passing>
- <https://docs.temporal.io/develop/typescript/workflows/continue-as-new>
- <https://docs.temporal.io/develop/typescript/workflows/versioning>

### Inngest

Inngest is the most direct benchmark for event-driven serverless workflow DX.

- Functions trigger from events or cron. Cron supports time zones and jitter,
  with documented DST caveats.
- `step.sleep`, `step.sleepUntil`, and `step.waitForEvent` are durable waits.
  Public docs note sleep limits up to a year on paid plans and shorter limits on
  free plans.
- Concurrency is active step execution, not paused runs. Sleeping, waiting, and
  paused-between-step runs do not count against concurrency.
- Flow control includes concurrency keys/scopes, throttling, rate limiting,
  debouncing, batching, cancellation, and priority.
- Idempotency exists at event and function levels, commonly with a 24-hour
  duplicate window.

TanStack implication: our docs should explicitly say paused runs do not consume
host execution time, but queue/concurrency slots are controlled by the chosen
driver. We should also copy the separation between concurrency and throttling.

Primary docs:

- <https://www.inngest.com/docs/guides/scheduled-functions>
- <https://www.inngest.com/docs/learn/inngest-steps>
- <https://www.inngest.com/docs/guides/concurrency>
- <https://www.inngest.com/docs/guides/throttling>
- <https://www.inngest.com/docs/guides/handling-idempotency>

### Trigger.dev

Trigger.dev is a strong benchmark for productized task operations.

- Scheduled tasks can be declarative or imperative. Schedules can be attached,
  listed, updated, activated, deactivated, deleted, and created dynamically.
- Schedule payloads include useful operational fields like scheduled timestamp,
  last timestamp, timezone, schedule id, external id, and upcoming run times.
- Waits checkpoint runs and release concurrency slots. Waits cover time delays,
  dates, and external tokens.
- Queues/concurrency are first-class, including shared queues and per-trigger
  overrides.
- Task runs are version locked. Replays are new runs with the same input on the
  latest code version.
- Idempotency keys support scopes like run, attempt, and global.

TanStack implication: the schedule payload shape is worth copying. It lets users
write backfill-safe scheduled jobs without asking the scheduler again.

Primary docs:

- <https://trigger.dev/docs/tasks/scheduled>
- <https://trigger.dev/docs/queue-concurrency>
- <https://trigger.dev/docs/idempotency>
- <https://trigger.dev/docs/versioning>
- <https://trigger.dev/docs/wait-for-token>

### Restate

Restate is the strongest "bring durable execution to normal service handlers"
comparison.

- Durable steps wrap nondeterministic operations and journal their results.
- Timers include sleep, delayed messages, and operation timeouts. Restate
  recommends delayed messages over very long sleeps when possible because long
  invocations require old deployments to remain available.
- Workflows are keyed and can receive events/handlers. Idempotency keys can be
  supplied on requests.
- Versioning is deployment-centric. Restate registers immutable deployments and
  keeps existing invocations on their original endpoint, including FaaS
  version-specific URLs or ARNs.

TanStack implication: our deployment docs should teach the same split:
short-lived handler invocations are fine, but paused workflow versions must
remain registered or bundled until they drain.

Primary docs:

- <https://docs.restate.dev/develop/ts/journaling-results>
- <https://docs.restate.dev/develop/ts/durable-timers>
- <https://docs.restate.dev/tour/workflows>
- <https://docs.restate.dev/services/versioning>

### DBOS

DBOS is the strongest Postgres-backed library comparison.

- Workflows recover from the last completed step after process crashes.
- Durable sleep stores the wakeup time in the database.
- Schedules are stored in the database and can be created, paused, resumed,
  deleted, listed, backfilled, and manually triggered.
- Scheduled workflow invocations are exactly once per interval via deterministic
  schedule-name plus scheduled-time identity.
- Queues are persisted in the system database and support global concurrency,
  worker concurrency, rate limits, priority, and runtime reconfiguration.
- Production recovery and version guidance is explicit: recover interrupted work
  and drain old versions before removing them.

TanStack implication: Postgres should probably be the first "serious" store
adapter because it can support run state, event log, timer index, schedules,
leases, search, and queue limits in one substrate.

Primary docs:

- <https://docs.dbos.dev/typescript/tutorials/workflow-tutorial>
- <https://docs.dbos.dev/typescript/tutorials/scheduled-workflows>
- <https://docs.dbos.dev/typescript/reference/queues>
- <https://docs.dbos.dev/production/self-hosting/workflow-recovery>
- <https://docs.dbos.dev/architecture>

### Cloudflare Workflows

Cloudflare Workflows is the built-in platform benchmark for the Cloudflare POC.

- Workflows provide durable multi-step execution, sleeps, retries, event waits,
  lifecycle APIs, and status inspection.
- `waitForEvent` targets a specific workflow instance and can time out between
  one second and 365 days.
- Instances waiting for sleep, retry, or event do not count toward concurrency
  limits.
- Cron Triggers are UTC, configured on Workers, can bind directly to Workflows,
  and have propagation/observability behavior documented separately from
  Workflows.

TanStack implication: Cloudflare is the destination where a capability adapter
can be richest: Durable Object backed `RunStore`, timer index, and possibly DO
alarms or Cron Triggers for sweep. We still should not require Cloudflare-only
APIs in core.

Primary docs:

- <https://developers.cloudflare.com/workflows/>
- <https://developers.cloudflare.com/workflows/build/events-and-parameters/>
- <https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/>
- <https://developers.cloudflare.com/workflows/reference/limits/>
- <https://developers.cloudflare.com/workers/configuration/cron-triggers/>

### AWS Step Functions

Step Functions is the serverless state-machine benchmark.

- Standard workflows can run up to one year. Wait states support relative
  seconds and absolute timestamps, with Express workflows having much shorter
  wait limits.
- Callback task tokens pause a workflow until an external `SendTaskSuccess` or
  `SendTaskFailure`, up to the service execution quota.
- Versions and aliases provide immutable workflow definitions and weighted
  deployment routing.
- Redrive can restart unsuccessful Standard executions from the failed step
  within eligibility constraints while preserving successful history.

TanStack implication: "redrive from failed step" is a high-value admin feature.
We can implement it more naturally because step checkpoints already exist.

Primary docs:

- <https://docs.aws.amazon.com/step-functions/latest/dg/state-wait.html>
- <https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html>
- <https://docs.aws.amazon.com/step-functions/latest/dg/concepts-cd-aliasing-versioning.html>
- <https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html>

### Azure Durable Functions

Azure Durable Functions is the classic serverless-code workflow benchmark.

- Orchestrators use event sourcing and replay to rebuild local state.
- Durable timers and external events are built-in; native sleeps and direct I/O
  in orchestrators are constrained because of replay.
- Sub-orchestrations, durable timers, external events, error handling, and
  retry policies are documented patterns.
- Eternal orchestrations use continue-as-new to avoid unbounded history growth.
- Versioning guidance is serious: "do nothing" is discouraged; side-by-side
  deployments and task-hub versioning are recommended for breaking changes.

TanStack implication: docs should be explicit about deterministic APIs
(`ctx.now`, `ctx.uuid`, `ctx.step`) and what not to do directly inside workflow
code if it would break replay.

Primary docs:

- <https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-orchestrations>
- <https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-code-constraints>
- <https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-eternal-orchestrations>
- <https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-versioning>

### Hatchet

Hatchet is a useful benchmark for durable task queue operations.

- Durable tasks checkpoint into an event log and can replay after worker crash
  without duplicating completed work.
- Durable tasks wait on sleeps, event waits, or child tasks, and these can be
  composed.
- Scheduled runs are one-shot future task triggers that can be created,
  deleted, listed, rescheduled, and bulk managed; code-defined cron runs are a
  related surface.
- Schedule docs explicitly call out UTC storage, best-effort enqueue timing,
  missed schedule behavior, and overlap behavior through concurrency policy.
- Flow control includes concurrency, rate limits, and priority. Operations
  include bulk retries/cancellations.

TanStack implication: the admin API should include bulk operations early. Teams
will need to cancel/retry batches when a bad deploy or external outage happens.

Primary docs:

- <https://docs.hatchet.run/v1/durable-execution>
- <https://docs.hatchet.run/v1/scheduled-runs>
- <https://docs.hatchet.run/v1/concurrency>
- <https://docs.hatchet.run/v1/rate-limits>

### Dapr Workflow

Dapr is relevant for self-hosted, sidecar-based users.

- Workflows run with Dapr's built-in workflow runtime and can be managed by HTTP
  and gRPC APIs: start, query, pause/resume, raise event, terminate, and purge.
- Durable timers can wait for arbitrary ranges and unload from memory while
  waiting.
- External events are targeted to workflow instances and can be processed FIFO
  when multiple events of the same name are awaited.
- Child workflows have independent instance IDs, status, and history; terminating
  a parent terminates its children.
- Continue-as-new exists to restart a workflow with new input and new history.

TanStack implication: management APIs should be treated as part of the product,
not just internal helpers.

Primary docs:

- <https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-overview/>
- <https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-features-concepts/>

### Google Cloud Workflows

Google Cloud Workflows is useful for callback semantics.

- Workflows can create callback endpoints and then await callbacks without
  polling.
- Callback waits have explicit timeout behavior and IAM requirements.
- Callback slots are tied to the workflow execution that created them, and
  callback delivery is idempotent.
- Scheduling is usually external through Cloud Scheduler, Eventarc, Pub/Sub, or
  Cloud Tasks.

TanStack implication: callback-token style ingress is worth documenting as an
alternative to "send signal by run id", especially for approvals and webhooks.

Primary docs:

- <https://cloud.google.com/workflows/docs/creating-callback-endpoints>
- <https://cloud.google.com/workflows/docs/trigger-workflow-eventarc>
- <https://cloud.google.com/workflows/docs/creating-updating-workflow>

### LangGraph and Mastra

These are less direct workflow-engine competitors, but they shape AI workflow
expectations.

- LangGraph persistence checkpoints graph state and enables human-in-the-loop,
  memory, time travel, and fault-tolerant execution.
- Mastra snapshots persist suspended workflow state and support suspend/resume
  workflows for human input or async events.

TanStack implication: AI users expect pause/resume, state inspection, and
human-in-the-loop to be easy. They may not expect full deterministic replay
language constraints, so docs need to explain what durability means here.

Primary docs:

- <https://docs.langchain.com/oss/javascript/langgraph/durable-execution>
- <https://mastra.ai/en/reference/workflows/snapshots>
- <https://mastra.ai/en/docs/workflows/suspend-and-resume>

## TanStack Workflow current strengths

- The core is host-agnostic. `runWorkflow` needs a workflow, input, run id, and
  `RunStore`.
- `RunStore` is already the right abstraction for state plus append-only log,
  with CAS on append and optional subscription.
- `ctx.step` covers durable side effects with retries and timeouts.
- `ctx.sleep` / `ctx.sleepUntil` and `ctx.waitForEvent` use the same pause/resume
  machinery.
- `ctx.approve` is a first-class approval primitive instead of making users
  build it only from raw events.
- `ctx.now` and `ctx.uuid` record deterministic values for replay.
- `version` plus `previousVersions` is a pragmatic library-native answer to
  in-flight runs across deploys.
- Deployment POCs prove the serverless shape:
  - each host invocation runs until finish or pause
  - state/log live in an external store
  - cron or alarms sweep due timers
  - HTTP/webhooks resume waits by delivering stable signals

## Priority blind spots

### P0 - production blockers

#### 1. Timer index and wakeup leasing

Current state: `waitingFor.deadline` exists, and POCs scan due timers.

Need:

- `listDueTimers(now, limit)` or equivalent query.
- `claimTimer(runId, stepId, leaseTtl)` to avoid duplicate sweepers.
- Stable timer signal id generation.
- Stale lease recovery.
- Timer cancellation when a run resumes, finishes, aborts, or waits on a
  different signal.
- Batching, jitter, and max budget per sweep.

This can live in a capability interface, not in workflow core:

```ts
interface TimerDriver {
  sweepDueTimers(args: {
    now: number
    limit?: number
    leaseTtlMs?: number
    budgetMs?: number
  }): Promise<Array<{ runId: string; delivered: boolean }>>
}
```

#### 2. Durable store adapters

The in-memory store is correct for tests and examples, but production adoption
needs at least one serious store.

Recommended order:

1. Postgres: run state, append log, timer index, schedule records, leases,
   search, retention, and queue limits in one database.
2. Cloudflare Durable Object / D1: strongest story for Workers.
3. Redis/Upstash: portable serverless POC path, but watch CAS, scanning, and
   retention semantics.

#### 3. Schedule records, not just cron recipes

Existing docs correctly recommend external cron plus fresh invocation per tick.
Competitors show users will ask for more.

Minimum schedule package:

```ts
interface WorkflowSchedule {
  id: string
  workflowId: string
  cron?: string
  intervalMs?: number
  timezone?: string
  input: unknown | ((tick: ScheduleTick) => unknown)
  overlapPolicy: 'skip' | 'buffer-one' | 'buffer-all' | 'allow'
  catchupPolicy?: 'none' | 'latest' | 'all'
  paused?: boolean
}
```

Minimum operations:

- create/update/delete/list/get schedule
- pause/resume
- trigger now
- compute next runs
- backfill a range
- deterministic run id per scheduled tick
- record last success/failure

#### 4. Version drain tooling

`previousVersions` is a good primitive, but teams need to know when it is safe
to delete old handlers.

Need:

- build manifest of workflow ids and versions
- query runs by `workflowId` and `workflowVersion`
- "versions still reachable" report
- deployment docs per host explaining how old code stays bundled or reachable
- replay-safety fixture tests
- optional ESLint/build checks for changes to workflow code without version bump

#### 5. Run search and admin API

Users need to answer operational questions:

- Which runs are paused?
- Which runs are waiting for `payment-received`?
- Which timers are overdue?
- Which runs are on workflow version `v1`?
- Which runs failed in the last hour?
- Can I abort/retry/redrive this run?

This likely belongs in a `RunQueryStore` extension rather than the minimal
`RunStore`.

### P1 - important adoption gaps

#### 6. Timeout semantics for waits

Today `deadline` is metadata surfaced to hosts. Competitors define timeout
behavior:

- timeout resolves with a value
- timeout throws
- timeout sends a synthetic signal
- timeout moves to failure

Recommendation: add an explicit `timeout` option or document the current
host-driven pattern. Avoid overloading `deadline` silently.

#### 7. Event buffering

If an event arrives before the workflow reaches `waitForEvent`, what happens?

Competitors vary:

- callback slots buffer one callback
- event systems filter future events
- signals can update workflow state before the main code awaits

Recommendation: keep default targeted delivery strict, but provide an optional
event inbox keyed by run id/name/idempotency key for webhook-heavy use cases.

#### 8. Queue and concurrency package

Minimum design dimensions:

- limit active runs by workflow id
- limit active steps by workflow id or step id
- per-tenant keys
- shared queues across workflows
- FIFO and priority
- throttling/rate-limit starts
- release slot while paused
- bulk pause/cancel/retry

This should be separate from `RunStore`, but durable stores can implement both.

#### 9. Redrive and replay

Step Functions and Trigger.dev make retry/replay visible. TanStack can do:

- redrive failed run from failed step with same workflow version
- replay as a new run with latest version
- retry only failed step if prior checkpoints are valid
- copy input and selected metadata/tags

Need clear naming because "replay" can mean deterministic log replay or user
requested rerun.

#### 10. History compaction / continue-as-new

Docs should strongly discourage infinite loops with `sleep` for recurring work.
For legitimate long-running entity workflows, add one of:

- `ctx.continueAsNew(input)`
- child workflow split
- snapshot plus archived log
- retention policy with terminal archive

### P2 - product polish and docs

#### 11. Human approval UX contract

`ctx.approve` should grow documentation around:

- approver identity and assignment
- expiration
- reminders
- escalation
- denial reason
- ACL and audit trail
- rendering metadata

The core primitive can stay small. The contract matters because approvals are a
main reason teams pick durable workflows.

#### 12. Security and tenancy guide

Every deployment guide should include:

- authenticate workflow routes
- verify cron route secret or provider signature
- verify webhook signatures
- scope tokens by environment/tenant
- encrypt or redact payloads
- do not expose a public store endpoint in production
- retention and deletion policy

The current Cloudflare-backed public `/store` POC should be documented as a
temporary deployment shortcut only.

## POC/demos we should ship

The current three deployment POCs are a good start. To make them persuasive, each
destination should prove the same features with the same workflow names:

1. Start a workflow and finish a normal durable step.
2. Pause on `ctx.sleepUntil`.
3. Wake via provider cron/timer sweep.
4. Pause on `ctx.waitForEvent`.
5. Resume through HTTP/webhook signal with stable `signalId`.
6. Duplicate the timer sweep and duplicate the signal to prove idempotency.
7. Run a cron-style schedule where each tick is a fresh run with deterministic
   run id.
8. Attach/read the log while the run is paused.
9. Deploy a new workflow version while a run is paused and resume it through
   `previousVersions`.
10. Show the run in a tiny admin page or JSON route: status, wait reason,
    deadline, version, log length.

Destination-specific demos:

- Cloudflare: Durable Object-backed store, Cron Trigger sweep, optional DO alarm
  notes, Workers route for signal ingress.
- Vercel: Route handlers/functions, Vercel Cron hitting sweep route, external
  store adapter, deployment/version note.
- Netlify: Functions and Scheduled Functions, external store adapter,
  deployment/version note.
- Node/Postgres: long-running worker plus Postgres store. This is likely the
  clearest production reference implementation.
- AWS Lambda/EventBridge/Postgres or DynamoDB: optional second-wave demo because
  Step Functions is the mental model many teams compare against.

## Recommended package map

Keep `@tanstack/workflow-core` small:

- workflow definition
- run engine
- primitives
- minimal `RunStore`
- in-memory store
- request parsing helpers

Add capability packages:

- `@tanstack/workflow-store-postgres`
- `@tanstack/workflow-store-cloudflare`
- `@tanstack/workflow-store-redis`
- `@tanstack/workflow-schedules`
- `@tanstack/workflow-timers`
- `@tanstack/workflow-queues`
- `@tanstack/workflow-devtools`
- `@tanstack/workflow-testing`

The deployment guides should compose these capabilities instead of hiding them
behind provider-specific adapters.

## Documentation outline to cover the bases

1. "How long-lived workflows work on serverless"
   - invocation runs until finish or pause
   - state/log are external
   - timers are swept by host cron or a worker
   - events resume by run id or callback token
2. "Durable stores"
   - store requirements
   - CAS append
   - timer index
   - retention
   - auth/security
3. "Timers and sleeps"
   - deadline semantics
   - sweepers
   - duplicate delivery
   - precision/skew by provider
4. "Recurring schedules"
   - fresh invocation per tick
   - overlap policies
   - catchup/backfill
   - time zones/DST
5. "Events, webhooks, approvals"
   - signal idempotency
   - schemas
   - timeout behavior
   - human approval pattern
6. "Deploying workflow changes"
   - versions
   - `previousVersions`
   - draining old versions
   - provider-specific code reachability
7. "Operations"
   - search/list runs
   - redrive/retry/cancel
   - metrics/logs/traces
   - bulk actions
8. "Provider recipes"
   - Cloudflare
   - Vercel
   - Netlify
   - Node/Postgres
   - AWS

## Sources

Temporal:

- <https://docs.temporal.io/schedule>
- <https://docs.temporal.io/develop/typescript/workflows/message-passing>
- <https://docs.temporal.io/develop/typescript/workflows/continue-as-new>
- <https://docs.temporal.io/develop/typescript/workflows/versioning>

Inngest:

- <https://www.inngest.com/docs/guides/scheduled-functions>
- <https://www.inngest.com/docs/learn/inngest-steps>
- <https://www.inngest.com/docs/guides/concurrency>
- <https://www.inngest.com/docs/guides/throttling>
- <https://www.inngest.com/docs/guides/handling-idempotency>

Trigger.dev:

- <https://trigger.dev/docs/tasks/scheduled>
- <https://trigger.dev/docs/queue-concurrency>
- <https://trigger.dev/docs/idempotency>
- <https://trigger.dev/docs/versioning>
- <https://trigger.dev/docs/wait-for-token>

Restate:

- <https://docs.restate.dev/develop/ts/journaling-results>
- <https://docs.restate.dev/develop/ts/durable-timers>
- <https://docs.restate.dev/tour/workflows>
- <https://docs.restate.dev/services/versioning>

DBOS:

- <https://docs.dbos.dev/typescript/tutorials/workflow-tutorial>
- <https://docs.dbos.dev/typescript/tutorials/scheduled-workflows>
- <https://docs.dbos.dev/typescript/reference/queues>
- <https://docs.dbos.dev/production/self-hosting/workflow-recovery>
- <https://docs.dbos.dev/architecture>

Cloudflare:

- <https://developers.cloudflare.com/workflows/>
- <https://developers.cloudflare.com/workflows/build/events-and-parameters/>
- <https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/>
- <https://developers.cloudflare.com/workflows/reference/limits/>
- <https://developers.cloudflare.com/workers/configuration/cron-triggers/>

AWS Step Functions:

- <https://docs.aws.amazon.com/step-functions/latest/dg/state-wait.html>
- <https://docs.aws.amazon.com/step-functions/latest/dg/connect-to-resource.html>
- <https://docs.aws.amazon.com/step-functions/latest/dg/concepts-cd-aliasing-versioning.html>
- <https://docs.aws.amazon.com/step-functions/latest/dg/redrive-executions.html>

Azure Durable Functions:

- <https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-orchestrations>
- <https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-code-constraints>
- <https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-eternal-orchestrations>
- <https://learn.microsoft.com/en-us/azure/azure-functions/durable/durable-functions-versioning>

Hatchet:

- <https://docs.hatchet.run/v1/durable-execution>
- <https://docs.hatchet.run/v1/scheduled-runs>
- <https://docs.hatchet.run/v1/concurrency>
- <https://docs.hatchet.run/v1/rate-limits>

Dapr:

- <https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-overview/>
- <https://docs.dapr.io/developing-applications/building-blocks/workflow/workflow-features-concepts/>

Google Cloud Workflows:

- <https://cloud.google.com/workflows/docs/creating-callback-endpoints>
- <https://cloud.google.com/workflows/docs/trigger-workflow-eventarc>
- <https://cloud.google.com/workflows/docs/creating-updating-workflow>

AI workflow adjacent:

- <https://docs.langchain.com/oss/javascript/langgraph/durable-execution>
- <https://mastra.ai/en/reference/workflows/snapshots>
- <https://mastra.ai/en/docs/workflows/suspend-and-resume>
