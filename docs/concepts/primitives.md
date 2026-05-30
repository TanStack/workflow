---
id: primitives
title: Primitives
---

Every durable operation goes through `ctx.*`. Each primitive has one recipe and one footgun.

## Stable operation IDs

Every durable primitive records a `stepId` in the log. `ctx.step(id, ...)`
already takes one. For the other primitives, pass `id` in the options object
when the operation is important or likely to be reordered later:

```ts
const startedAt = await ctx.now({ id: 'started-at' })
await ctx.sleepUntil(deadline, { id: 'cooldown' })
const payload = await ctx.waitForEvent('payment', { id: 'payment-webhook' })
const decision = await ctx.approve({ id: 'legal-review', title: 'Ship?' })
```

If omitted, the engine generates a positional internal ID for backwards-compatible
ergonomics. Explicit IDs are safer for long-lived workflows and future versions.

## `ctx.step(id, fn, opts?)`

Run `fn` durably. Returns its value. Replays from the log on subsequent invocations.

```ts
const data = await ctx.step('fetch-user', (stepCtx) =>
  fetch('/api/user', { headers: { 'Idempotency-Key': stepCtx.id } }).then((r) => r.json())
)
```

Options:
- `retry`: `{ maxAttempts, backoff?, baseMs?, shouldRetry? }`
- `timeout`: per-attempt wall-clock budget in ms
- `meta`: free-form metadata copied into `STEP_*` events

```ts
await ctx.step(
  'flaky-call',
  () => unstableApi(),
  {
    retry: { maxAttempts: 3, backoff: 'exponential', baseMs: 250 },
    timeout: 5000,
  },
)
```

**Footgun**: Duplicate `id` per call site is a programmer error. In loops, interpolate: `ctx.step(\`charge-${i}\`, fn)`.

## `ctx.sleep(ms, opts?)` / `ctx.sleepUntil(timestamp, opts?)`

Durable pause. Engine emits `SIGNAL_AWAITED { name: '__timer', deadline }`. Run resumes when the host delivers the `__timer` signal.

```ts
await ctx.sleep(60_000)              // wake in 60s
await ctx.sleepUntil(nextMidnight()) // wake at a wall-clock time
await ctx.sleepUntil(deadline, { id: 'cooldown', meta: { reason: 'rate-limit' } })
```

**Footgun**: `Date.now()` inside the handler is non-deterministic. Anchor with `ctx.now()` if you need a stable deadline across replays.

## `ctx.waitForEvent(name, opts?)`

Pause until the host delivers a signal with this `name`. Returns the payload.

```ts
const now = await ctx.now()
const payload = await ctx.waitForEvent('webhook-received', {
  id: 'stripe-webhook',
  schema: z.object({ reference: z.string() }),
  meta: { source: 'stripe' },     // visible to the host driver
  deadline: now + 86_400_000,     // host wakes if not delivered
})
```

Resume by calling `runWorkflow({ runId, signalDelivery: { signalId, name, payload } })`.

**Footgun**: Multiple unnamed `waitForEvent` calls with the same `name` match
their generated operation IDs by call order. Use explicit `id`s when two waits
share a signal name or when you may reorder the workflow later.

## `ctx.approve({ title, description? })`

Pause for a human decision. Returns `{ approved, approvalId, feedback? }`.

```ts
const decision = await ctx.approve({
  id: 'publish-approval',
  title: 'Publish article?',
  description: draft.title,
})
if (!decision.approved) return { status: 'rejected', notes: decision.feedback }
```

Resume by calling `runWorkflow({ runId, approval: { approvalId, approved, feedback? } })`.

**Footgun**: unnamed approvals are positional. Use explicit `id`s for approvals
that may move, and use `previousVersions` when changing in-flight workflow code.

## `ctx.now()` / `ctx.uuid()`

Deterministic recorded values. First execution captures, replay returns the same.

```ts
const startedAt = await ctx.now({ id: 'started-at' })
const correlationId = await ctx.uuid({ id: 'correlation-id' })
```

**Footgun**: Calling `Date.now()` or `crypto.randomUUID()` directly is a determinism violation. Replay won't match. Multiple unnamed `now()` / `uuid()` calls are positional, so give important recorded values explicit `id`s.

## `ctx.emit(name, value)`

Synchronous, non-durable observability event. Reaches live subscribers; not persisted.

```ts
ctx.emit('progress', { step: 3, of: 10 })
```

**Use for**: UI hints, telemetry, devtools breadcrumbs. **Don't use for** anything the engine should replay.

## `ctx.signal`

Run-level `AbortSignal`. Already-aborted state propagates to `step` fns via `stepCtx.signal`.

```ts
await ctx.step('long-fetch', (stepCtx) =>
  fetch(url, { signal: stepCtx.signal }),
)
```

## `succeed` / `fail`

Tagged return helpers. Avoids `as const` clutter on discriminated unions.

```ts
import { succeed, fail } from '@tanstack/workflow-core'

if (review.verdict === 'block') return fail(`legal: ${review.findings.join('; ')}`)
return succeed({ article: draft })
```
