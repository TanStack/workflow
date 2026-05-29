---
id: replay-and-resume
title: Replay and Resume
---

Workflows are closures. Every invocation runs the handler from the top. Replay short-circuits past completed work by reading the event log.

## The log

Append-only. Optimistic-CAS on `expectedNextIndex`. Stored via `RunStore.appendEvent(runId, index, event)`.

**Checkpoint events** — replay reads these to skip work:
- `STEP_FINISHED` / `STEP_FAILED`
- `SIGNAL_RESOLVED` / `APPROVAL_RESOLVED`
- `NOW_RECORDED` / `UUID_RECORDED`
- `RUN_FINISHED` / `RUN_ERRORED`

**Coordination events** — persisted so hosts and resume calls can identify the pending wait:
- `SIGNAL_AWAITED`
- `APPROVAL_REQUESTED`

**Observability-only events** — emit-only, not persisted:
- `RUN_STARTED`, `STEP_STARTED`
- `STATE_DELTA`
- `CUSTOM` (from `ctx.emit`)

## How replay works

For each `ctx.step('id', fn)`:
1. Walk the log for `STEP_FINISHED` / `STEP_FAILED` with this `id`.
2. Found → return the recorded result (or rethrow the recorded error). **`fn` is NOT called.**
3. Not found → run `fn`, append `STEP_FINISHED`, return.

Same algorithm for `waitForEvent` (by `name`, sequential match), `approve` (positional), `now`, `uuid`.

## Determinism contract

The handler **must** reach the same primitives in the same order on every replay:

```ts
// Determinism violations:
const t = Date.now()                 // use ctx.now()
const id = Math.random()             // use ctx.uuid()
if (await fetchFlag()) { ... }       // wrap the fetch in ctx.step()

// Safe:
const t = await ctx.now()
const id = await ctx.uuid()
const flag = await ctx.step('flag', fetchFlag)
if (flag) { ... }
```

State mutations re-run on replay. They're reapplied deterministically because they depend only on replayed step results.

## Pause and resume

Run pauses when the handler reaches:
- `ctx.approve` with no `APPROVAL_RESOLVED` in the log
- `ctx.waitForEvent(name)` with no matching `SIGNAL_RESOLVED`
- `ctx.sleep` / `ctx.sleepUntil` (internally a signal-wait on `__timer`)

The engine writes `RunState.status = 'paused'` with `waitingFor` / `pendingApproval` populated, ends the event stream, and returns.

Resume:

```ts
runWorkflow({
  workflow,
  runId,
  runStore,
  // pick one:
  approval:        { approvalId, approved, feedback? },
  signalDelivery:  { signalId, name, payload },
})
```

The engine appends `APPROVAL_RESOLVED` or `SIGNAL_RESOLVED` to the log, re-runs the handler from the top, and replay carries through to the next primitive after the pause.

## Idempotency and lost races

Every signal delivery carries a `signalId`. Two deliveries for the same waiting name:

- **Same `signalId`** → idempotent. The engine no-ops and returns success.
- **Different `signalId`** → the loser sees `RUN_ERRORED { code: 'signal_lost' }`. The winner's payload is what the workflow sees.

Use this for safe webhook retries: pick a stable `signalId` per webhook event.

## Version routing

When workflow code changes, declare a version and keep old code reachable:

```ts
const v2 = createWorkflow({ id: 'pipeline', version: 'v2' })
  .previousVersions([v1])        // v1 stays callable for in-flight v1 runs
  .handler(async (ctx) => { /* v2 body */ })
```

On resume the engine reads `RunState.workflowVersion` and routes to the matching definition. Drop a version from `previousVersions` only after all runs at that version have terminated.

Mismatched version with nothing in `previousVersions` → `RUN_ERRORED { code: 'workflow_version_mismatch' }`.

## Attach (read-only subscribe)

A second subscriber (browser refresh, mobile reconnect) reads current state without driving the run forward:

```ts
runWorkflow({ workflow, runId, runStore, attach: true })
```

Engine emits: `RUN_STARTED` → replay of the log → terminal event (`RUN_FINISHED`, `RUN_ERRORED`, or pause info), then ends.

## Webhook execution

For Durable-Streams-style stateless invocations:

```ts
import { handleWorkflowWebhook } from '@tanstack/workflow-core'

await handleWorkflowWebhook({
  workflow,
  runStore,
  payload: { runId, signalDelivery, approval },
})
```

Same engine. One invocation drives the run to its next pause or completion. The HTTP handler returns; the durable stream / queue handles wake-ups.

## Cleanup

Terminal runs remain in the store so attach calls and webhook retries can read the final log. Stores decide their retention policy; the in-memory store expires non-paused runs after its TTL (1h default). Hosts can still call `RunStore.deleteRun(runId, reason)` when they want immediate cleanup.

## What the log contains, end to end

```
[
  // RUN_STARTED — emit only, not in the persisted log
  STEP_FINISHED   { stepId: 'fetch-user', result: { id: 'u-1', tier: 'pro' } },
  NOW_RECORDED    { stepId: '__now-0', value: 1737499200000 },
  SIGNAL_AWAITED  { stepId: '__wait-payment-0', name: 'payment', deadline: ... },
  SIGNAL_RESOLVED { stepId: '__resolve-payment', name: 'payment', signalId: 'evt-1', payload: { ... } },
  APPROVAL_REQUESTED { approvalId: 'a-1', title: 'Continue?' },
  APPROVAL_RESOLVED  { approvalId: 'a-1', approved: true },
  STEP_FINISHED   { stepId: 'finalize', result: { ok: true } },
  RUN_FINISHED    { runId, output: { ok: true } },
]
```

Replay walks this; observers tail it.
