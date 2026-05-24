# Scheduling and recurring runs

`@tanstack/workflow-core` ships no cron primitive. The shape every mature workflow engine converges on — Inngest, Trigger.dev, Temporal, Hatchet, DBOS — is **external scheduler + fresh workflow invocation per tick**. Bring your own scheduler. The engine doesn't need to know.

This page is recipes for that pattern.

## The model in one paragraph

You declare a normal workflow. Something outside the engine (cron daemon, EventBridge, Durable Object alarm, Vercel Cron Job, a `setInterval` in a worker, anything) fires on schedule. Each tick calls `runWorkflow({ workflow, input, runStore })` with fresh input. The workflow runs end-to-end and finishes; the next tick is a new `runId`. No "loop forever with sleep" — log doesn't grow, replay cost is constant, and "when's the next run?" is answerable from the scheduler, not from the engine.

## Recipe: a node process with `node-cron`

```ts
import cron from 'node-cron'
import { runWorkflow, inMemoryRunStore } from '@tanstack/workflow-core'
import { dailyReport } from './workflows/daily-report'

const runStore = inMemoryRunStore() // swap for a durable adapter in prod

// 09:00 every Monday in UTC
cron.schedule(
  '0 9 * * MON',
  async () => {
    for await (const _ of runWorkflow({
      workflow: dailyReport,
      input: { triggeredAt: Date.now() },
      runStore,
    })) {
      // events flow through here — forward to Redis, log, ignore
    }
  },
  { timezone: 'UTC' },
)
```

The workflow body itself is a normal one-shot:

```ts
export const dailyReport = createWorkflow({
  id: 'daily-report',
  input: z.object({ triggeredAt: z.number() }),
}).handler(async (ctx) => {
  const report = await ctx.step('gen', generateReport)
  await ctx.step('email', () => emailReport(report))
  return { ranAt: ctx.input.triggeredAt, report: report.summary }
})
```

## Recipe: Cloudflare Worker cron trigger

```toml
# wrangler.toml
[[triggers.crons]]
cron = "0 9 * * MON"
```

```ts
// worker.ts
import { runWorkflow } from '@tanstack/workflow-core'
import { dailyReport } from './workflows/daily-report'
import { d1RunStore } from './storage' // hypothetical D1-backed store

export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    const runStore = d1RunStore(env.DB)
    for await (const _ of runWorkflow({
      workflow: dailyReport,
      input: { triggeredAt: event.scheduledTime },
      runStore,
    })) {
      /* forward / log */
    }
  },
}
```

## Recipe: Vercel Cron Job hitting a route

```jsonc
// vercel.json
{
  "crons": [{ "path": "/api/cron/daily-report", "schedule": "0 9 * * MON" }]
}
```

```ts
// app/api/cron/daily-report/route.ts (App Router) or pages/api/cron/...
import { runWorkflow } from '@tanstack/workflow-core'
import { dailyReport } from '@/workflows/daily-report'
import { runStore } from '@/lib/run-store'

export async function GET(req: Request) {
  // Vercel signs the request; verify the secret before running
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 })
  }
  for await (const _ of runWorkflow({
    workflow: dailyReport,
    input: { triggeredAt: Date.now() },
    runStore,
  })) {
    /* … */
  }
  return new Response('ok')
}
```

## Recipe: AWS EventBridge → Lambda

```yaml
# serverless.yml (excerpt)
functions:
  dailyReport:
    handler: handlers/daily-report.handler
    events:
      - schedule: cron(0 9 ? * MON *) # EventBridge cron syntax — UTC
```

```ts
// handlers/daily-report.ts
import { runWorkflow } from '@tanstack/workflow-core'
import { dailyReport } from '../workflows/daily-report'
import { dynamoRunStore } from '../storage'

export const handler = async () => {
  for await (const _ of runWorkflow({
    workflow: dailyReport,
    input: { triggeredAt: Date.now() },
    runStore: dynamoRunStore(),
  })) {
    /* … */
  }
}
```

## Recipe: skip-overlap policy

Most schedulers (`cron`, EventBridge, Vercel) don't know whether the previous tick is still running. If you want "skip the new tick if the previous one is still in flight," gate on a marker in the run store before starting:

```ts
async function tick() {
  // Use a deterministic runId so concurrent ticks can't both create one.
  const runId = `daily-report:${new Date().toISOString().slice(0, 10)}` // one per day
  const existing = await runStore.getRunState(runId)
  if (existing && existing.status !== 'finished' && existing.status !== 'errored') {
    return // previous tick still running, skip
  }
  for await (const _ of runWorkflow({
    workflow: dailyReport,
    runId,
    input: { triggeredAt: Date.now() },
    runStore,
  })) {
    /* … */
  }
}
```

The engine's start-path idempotency check (same `runId` + same workflow fingerprint = attach-snapshot, not double-start) means a second-of-two concurrent calls degrades to read-only safely even if the gate above races.

## Recipe: buffer-one policy

If you want "if a tick fires while one is running, run it again as soon as the previous finishes," queue locally:

```ts
let pending = false
let inFlight: Promise<void> | null = null

async function tick() {
  if (inFlight) {
    pending = true
    return
  }
  inFlight = (async () => {
    for await (const _ of runWorkflow({ workflow: dailyReport, input: { triggeredAt: Date.now() }, runStore })) {
      /* … */
    }
  })().finally(async () => {
    inFlight = null
    if (pending) {
      pending = false
      await tick()
    }
  })
  await inFlight
}
```

Holds at most one pending tick — extra ticks during a long run collapse into a single follow-up.

## Recipe: writing your own schedule store

For shops that don't have a host-managed cron, run a tiny worker that polls a schedule table:

```ts
interface Schedule {
  id: string
  workflowId: string
  cronExpr: string
  nextFireAt: number
  inputBuilder: () => unknown
  overlapPolicy: 'skip' | 'buffer' | 'allow'
}

async function tickAllSchedules(schedules: Array<Schedule>, runStore: RunStore) {
  const now = Date.now()
  for (const s of schedules) {
    if (s.nextFireAt > now) continue
    await fireOne(s, runStore)
    s.nextFireAt = computeNext(s.cronExpr, now) // use a cron-parser lib
  }
}

// Long-running worker
setInterval(() => tickAllSchedules(schedules, runStore), 30_000)
```

A more durable version persists `nextFireAt` alongside each schedule definition; a deeper one elects a single leader to avoid duplicate ticks across instances. That whole layer is what a future `@tanstack/workflow-cron` package would provide. The design sketch lives in [`research/SCHEDULING.md`](https://github.com/TanStack/workflow/blob/main/research/SCHEDULING.md).

## Test pattern

The repo's `tests/examples.external-cron.test.ts` exercises this end-to-end with vitest fake timers — a deterministic scheduler driving multiple ticks against the engine, verifying each tick produces an independent run and that skip-overlap works.
