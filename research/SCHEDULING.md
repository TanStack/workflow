# Scheduling and cron — landscape

How major workflow engines model recurring execution, and what that implies for TanStack Workflow.

## What we have today

- `ctx.sleep(ms)` / `ctx.sleepUntil(timestamp)` durably pause a run by emitting `SIGNAL_AWAITED { name: '__timer', deadline }`.
- `RunState.waitingFor = { signalName: '__timer', deadline }` is persisted, so out-of-process workers can discover pending wakes by querying the store.

No timer driver and no cron primitive ship in `@tanstack/workflow-core`. The engine emits deadlines; nothing currently consumes them.

## How others handle it

| Library                   | Where the cron is declared                                                                                 | Who fires the tick        | Workflow body                                                                              | Overlap handling                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| **Inngest**               | On the function: `inngest.createFunction({ id, cron: '0 9 * * MON' }, ...)`                                | Inngest control plane     | Fresh invocation per tick                                                                  | Per-function `concurrency`                                                                            |
| **Trigger.dev**           | On the task: `schedules.task({ cron: '0 * * * *' }, ...)`                                                  | Trigger scheduler service | Fresh run per tick                                                                         | `queue` + `concurrencyKey`                                                                            |
| **Temporal**              | Separate `Schedule` resource (recommended over the legacy CronWorkflow option)                             | Temporal matching service | Fresh workflow execution per tick                                                          | Explicit `overlapPolicy`: skip / buffer-one / buffer-all / cancel-other / terminate-other / allow-all |
| **Cloudflare Workflows**  | `wrangler.toml`'s `[[triggers.crons]]` on the Worker that _starts_ the workflow                            | Cloudflare edge cron      | Fresh workflow instance per tick                                                           | Application-level                                                                                     |
| **Hatchet**               | `@hatchet.workflow(schedule="0 9 * * MON")` decorator or fluent API                                        | Hatchet engine            | Fresh run per tick                                                                         | `concurrency_limit` + group keys                                                                      |
| **DBOS**                  | `@DBOS.scheduled('0 9 * * MON')` decorator                                                                 | DBOS runtime              | Fresh invocation per tick                                                                  | Per-workflow `WorkflowQueue`                                                                          |
| **Restate**               | `ctx.workflowSendDelayed(...)` for one-shot delays; recurring is built by the user with self-delayed sends | Restate server            | Fresh handler invocation; the workflow self-schedules the next tick at the end of each run | Single-writer per object/workflow id                                                                  |
| **AWS Step Functions**    | EventBridge Rule / EventBridge Scheduler outside the state machine                                         | EventBridge               | Fresh execution per tick                                                                   | Application-level (Distributed Map has its own controls)                                              |
| **Vercel WDK**            | Not in the SDK. Vercel Cron Jobs hits an HTTP route that starts the workflow                               | Vercel Cron service       | Fresh workflow per route invocation                                                        | Application-level                                                                                     |
| **Mastra / LangGraph.js** | Not built-in; users wire to external scheduler                                                             | External                  | Fresh run                                                                                  | Application-level                                                                                     |

## Patterns that come up consistently

**1. The cron metadata lives at the registration site, not in the workflow body.** Every mature engine separates _what the workflow does_ from _when it runs_. The workflow doesn't know it's being scheduled.

**2. Each tick is a fresh execution.** No "loop with sleep" production pattern anywhere. Reasons:

- Log doesn't grow unbounded.
- Replay cost stays constant per tick.
- "When's the next run?" is answerable from the schedule, not by inspecting a running workflow's pause state.
- Overlap policies are well-defined (skip if previous still running, buffer, etc.).
- Failed runs don't block the next tick.

**3. The scheduler is its own service.** Inngest, Trigger, Temporal, Hatchet, DBOS all run a scheduling component separate from the engine that drives workflow execution. It polls a schedule table / cron expression and fires new invocations.

**4. Overlap policies are explicit.** Temporal's six-option enum is the gold standard. Inngest / Trigger / Hatchet have variations. **Cloudflare and AWS push this to the user.** Restate's single-writer-per-object property gets it for free at the cost of forcing object-shaped modeling.

**5. Cron expression vs. delay-based.** Most use cron strings (`0 9 * * MON`). Restate's self-delayed-send model is the outlier — workflows reschedule themselves by enqueueing a delayed invocation at the end of each run. Durable, no separate scheduler, but requires the workflow to be aware of its own recurrence.

## Implications for TanStack Workflow

The closure engine already supports the "fresh invocation per tick" model — that's literally just calling `runWorkflow(...)` repeatedly. So a future `@tanstack/workflow-cron` package would be small.

### Sketch

```ts
// Hypothetical
import { createSchedule, runSchedules } from '@tanstack/workflow-cron'

createSchedule({
  id: 'daily-report',
  workflow: dailyReport, // a normal workflow definition
  cron: '0 9 * * MON',
  input: () => ({ runId: crypto.randomUUID() }),
  overlapPolicy: 'skip', // skip | buffer | cancel-previous | allow
})

// Run by a worker process (or DO alarm, or AWS scheduled task)
await runSchedules({ runStore, scheduleStore })
```

Two pieces:

- **Schedule definitions** — declarative, sit next to workflow definitions.
- **A driver** — polls a schedule store, computes "next fire time," fires `runWorkflow`. Can be deployed as a long-running worker, Durable Object alarm, AWS Lambda + EventBridge, Cloudflare Cron Trigger, etc.

### Three deployment options without re-implementing the scheduler

1. **Bring your own scheduler.** Most projects already have one (`node-cron`, EventBridge, Cloudflare Crons). Just call `runWorkflow` from it. Zero new package.
2. **Embedded driver.** `@tanstack/workflow-cron` ships a `runSchedules({ runStore, scheduleStore })` callable from a tiny always-on worker.
3. **Platform adapters.** `@tanstack/workflow-cron-do` (Durable Object alarms), `@tanstack/workflow-cron-eventbridge`, etc. Same schedule definitions, different driver.

### Other notes

- **The engine doesn't need any changes for cron.** The `sleep` / `sleepUntil` primitives + `runWorkflow` start path are already enough. A scheduler is purely additive.
- **Overlap policies are worth getting right from day one.** Temporal's six-mode design is well-trodden; copy it. Common defaults: `skip` (don't fire while one is running) and `allow` (fan out, no coordination).
- **The Restate self-rescheduling pattern is interesting but probably not the primary model.** It forces every recurring workflow to know about its own cadence, which is the coupling every other design explicitly avoids. It could be a secondary pattern for use cases that genuinely want self-pacing (backoff loops, retry-with-decay).

## Open questions

- **Schedule definition storage.** Inline in code (Inngest / DBOS / Hatchet) vs in a database (Temporal). The code-as-source-of-truth model has stronger ergonomics; the DB model lets non-developers add schedules. Probably code-first with an escape hatch.
- **Catch-up policy.** If the driver was down for an hour and missed three ticks, do we run the missed ticks (catch-up) or skip (last-run-wins)? Temporal supports both; most others assume skip. Default skip; opt-in catch-up.
- **Time zones.** Cron `0 3 * * *` is "3am in whose time zone?" Inngest takes a `tz` option. Default UTC; explicit override.
- **Cron parser dependency.** Real cron expressions need a library (`cron-parser`, `croner`, etc.). Adds a small dep. Worth scoping: do we ship full cron syntax or a narrower interval API (`every: '24h'`)?

## Status

Research and recipes. See [docs/concepts/scheduling.md](../docs/concepts/scheduling.md) for the user-facing recipes that exercise the "bring your own scheduler" pattern with what's shipping today, and [packages/workflow-core/tests/examples.external-cron.test.ts](../packages/workflow-core/tests/examples.external-cron.test.ts) for a vitest-driven test that proves the pattern works end-to-end (single-tick, skip-overlap, buffer-one).

No `@tanstack/workflow-cron` package yet. Recommendation: defer until at least one durable storage adapter ships, then design against a real Postgres / DO store rather than the in-memory one.
