---
id: durable-recovery
title: Signals, retries, and compensation
---

# Signals, retries, and compensation

Use the runtime with D1 or Postgres and schedule regular `runtime.sweep()` calls
for recovery across process restarts. The in-memory execution store implements
the same behavior for tests, but its data disappears with the process.

## Buffer signals before a wait

Enable buffering on the runtime:

```ts
const runtime = defineWorkflowRuntime({
  store,
  workflows,
  bufferSignals: true,
})

await runtime.deliverSignal({
  runId: 'order:123',
  signalId: 'payment:webhook:456',
  name: 'payment-received',
  payload: { paymentId: '456' },
})
```

The run must already exist. A delivery before run creation returns `not-found`.
A delivery while the run is queued, running, or waiting for something else is
saved in the inbox and returns `buffered`. A matching paused run can resume in
the same call. A competing worker may produce `not-claimable` after the inbox
write succeeds, so sweeps must remain enabled.

Each wait takes the oldest accepted signal with the same name. Order is the
store's insertion order for that run, not the caller's timestamp. An optional
`stepId` on delivery restricts it to that wait. Targeted signals do not block
other waits from consuming later matching signals. Consumption and the
`SIGNAL_RESOLVED` checkpoint are one atomic write, so a restart returns the
recorded payload instead of consuming another signal.

A `signalId` belongs to one run and is accepted once, even if the sender retries
with a different payload. Inbox entries, payloads, and deduplication IDs remain
until `deleteRun`. There is no automatic expiry or size limit. Apply your own
run-retention policy and ingress limits. New signals to finished, errored, or
aborted runs return `not-waiting`; already accepted IDs still return `duplicate`.
The internal `__timer` signal cannot be buffered through this API.

Without `bufferSignals: true`, existing delivery behavior stays unchanged:
a signal that arrives before a matching wait returns `not-waiting`. Approvals
also keep their existing behavior. Enabling buffering requires an adapter with
both `bufferSignal` and `consumeBufferedSignal`; unsupported adapters fail at
runtime construction with an explanation.

## Persist retries between attempts

```ts
const receipt = await ctx.step(
  'charge-card',
  ({ id, attempt, signal }) => chargeCard({
    orderId: ctx.input.orderId,
    idempotencyKey: id,
    attempt,
    signal,
  }),
  {
    retry: {
      durable: true,
      maxAttempts: 4,
      backoff: 'exponential',
      baseMs: 1_000,
    },
  },
)
```

`durable: true` records attempt starts, failed attempts, and the next attempt's
absolute deadline. A retry pauses the run, including retries with zero delay.
The next sweep at or after that deadline resumes it. A host scheduler determines
how soon after the deadline work actually runs. Retry delays are not a precise
execution-time guarantee.

Recorded failures count toward `maxAttempts` after a restart. A process that dies
during an attempt can repeat that same attempt number, because its outcome is
unknown. `StepContext.id` stays stable across all attempts. Use that ID, or your
own stable business key, for external idempotency. A timeout requests cancellation
through `AbortSignal`; it cannot undo an external request or force a function to
stop.

You can also set `defaultStepRetry: { durable: true, maxAttempts: 4 }` on the
workflow. Without `durable: true`, retries keep their existing in-process timing
and behavior. Direct users of `runWorkflow` must deliver the persisted timer
wait themselves or use the runtime to do it.

## Register compensation handlers

```ts
await ctx.compensate(
  'release-inventory',
  ({ id, signal }) => releaseInventory(ctx.input.orderId, {
    idempotencyKey: id,
    signal,
  }),
  { retry: { maxAttempts: 3, baseMs: 1_000 } },
)

await ctx.step('reserve-inventory', ({ id, signal }) =>
  reserveInventory(ctx.input.orderId, { idempotencyKey: id, signal }),
)

await ctx.step('charge-card', ({ id, signal }) =>
  chargeCard(ctx.input.orderId, { idempotencyKey: id, signal }),
)
```

Registration is persisted before `ctx.compensate` returns. On an uncaught
workflow failure, registered handlers run one at a time in reverse registration
order. Register before the effect when the undo operation can safely handle an
effect that never happened. Registering only after a step succeeds leaves a gap
if the effect succeeds but the worker dies before recording the step result.

Compensation is a durable step with automatic durable retries. The default is
one attempt; set `retry.maxAttempts` to allow more. Completed handlers are not
called again after a restart. An interrupted handler may run again with the same
idempotency key. If a handler exhausts its retries, compensation stops there and
the run records both the original failure and the compensation failure. Earlier
handlers remain unexecuted for operator review. If all handlers succeed, the run
still ends as `errored` with its original failure.

Keep registrations, IDs, and captured values deterministic. Replay runs the
workflow again to rebuild the handlers, so callbacks are loaded from code rather
than serialized into storage. Keep the matching workflow version available.
Use unique step and compensation IDs and keep application IDs out of the
`__compensation:` and `__retry:` namespaces. Await workflow primitives in order.
Inside a compensation handler, perform its external action directly with the
provided step context, without calling more workflow primitives.

Compensation is best-effort undo, not a database transaction or exactly-once
execution. It does not automatically run on cancellation, process termination,
handled errors, or a successful workflow return. A process crash first triggers
recovery; compensation starts only when the recovered workflow fails. A
compensation cannot guarantee reversal of an irreversible external effect. Both
forward and undo APIs must support your chosen idempotency keys and tolerate
repeated calls. Writes outside durable steps can run again during replay.

## Upgrade an existing deployment

1. Apply `0001_signal_inbox.sql` from the installed D1 or Postgres adapter before
   deploying its new code. Fresh installs apply `0000_workflow_store.sql` first.
   The new migration adds a table and indexes; it does not rewrite existing runs
   or histories. Both migrations can be applied again safely.
2. Upgrade core, runtime, and the store adapter together on all workers. Keep
   buffering and durable retries disabled during a mixed-version rollout. Old
   workers do not understand the new recovery checkpoints.
3. Keep previous workflow versions registered for existing runs. Enable the new
   behavior in a new workflow version when changing an in-flight definition
   would alter its control flow.
4. Keep regular sweeps enabled, including `maxRecoveredRuns` and `maxTimers`.
   Sweeps recover interrupted runs, unclaimed queued runs, pending inbox waits,
   and timer waits whose worker died before creating the timer row.
5. Enable `bufferSignals`, durable retry policies, and compensation registrations
   where needed. Existing histories need no conversion.

For example, an existing Postgres installation can apply:

```bash
psql "$DATABASE_URL" -f node_modules/@tanstack/workflow-store-drizzle-postgres/migrations/0001_signal_inbox.sql
```

D1 applications should copy the package's new migration into their configured
Wrangler migrations directory and apply it through their normal migration
process. For custom schemas or table names, use the adapter's
`get*WorkflowStoreMigrations(options)` helper and apply unapplied entries in
order. `get*WorkflowStoreMigrationSql(options)` now returns all migrations;
`ensureSchema()` also installs both, for explicit bootstrap use.

## Third-party stores and host responsibilities

The new inbox methods and `completeTimer` are optional. Existing adapters still
compile and run with default behavior. To support buffering, implement both
inbox methods with atomic consumption and run-lifetime deduplication. To support
crash-safe timer delivery, implement `completeTimer` so the runtime can record
resolution before acknowledging the timer. Adapters without it keep the legacy
timer-delivery path and its adapter-specific guarantees.

The runtime passes an optional `leaseOwner` to state writes, event appends,
inbox consumption, and timer scheduling. The built-in execution stores fence
these writes against the current lease. A supplied runtime `leaseOwner` is a
label; the runtime adds a unique suffix per drive so two invocations with the
same label cannot share ownership. Third-party adapters must enforce the token
in the same transaction or statement as the write to provide the same protection.
D1 fenced state and timer writes require native `batch` support. A Postgres
adapter without `transaction` must use a pinned connection for the entire
`BEGIN`/`COMMIT` sequence.

A persistence or heartbeat failure stops the current drive from making further
store writes and leaves recovery to a later sweep. Lease fencing protects the
workflow database. It cannot stop an external API call already in progress.
Configure enough lease time for ordinary database latency and respect the step's
abort signal where your external client supports it.

This runtime still depends on your database, scheduler, retention policy, and
operational monitoring. Its Cloudflare host adapter runs the TanStack engine and
sweeps, not the Cloudflare Workflows service.

See the [durable fulfillment example](https://github.com/TanStack/workflow/tree/main/examples/durable-recovery)
for a workflow that combines all three features.
