/**
 * External cron scheduling — what's possible with workflow-core today,
 * with zero engine changes. The engine doesn't ship a cron primitive
 * or a timer driver; the pattern every mature workflow library
 * converges on is **external scheduler + fresh workflow invocation
 * per tick**. This test exercises that pattern end-to-end.
 *
 * Three scenarios:
 *   1. A bare scheduler fires the workflow once per "minute" (driven
 *      by vitest fake timers). Each tick produces an independent
 *      runId and finishes cleanly.
 *   2. Skip-overlap policy via deterministic runId + state check.
 *   3. Buffer-one policy — if a tick fires while one is running,
 *      queue one follow-up.
 *
 * See docs/concepts/scheduling.md for the user-facing recipes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import type { WorkflowEvent } from '../src'
import { collect } from './test-utils'

// ============================================================
// Shared workflow — a one-shot run per tick. No internal sleep,
// no recurrence inside the body. The scheduler decides cadence.
// ============================================================

function makeDailyReport(workFn: () => Promise<{ summary: string }>) {
  return createWorkflow({
    id: 'daily-report',
    input: z.object({ triggeredAt: z.number() }),
  }).handler(async (ctx) => {
    const report = await ctx.step('gen', workFn)
    await ctx.step('email', () => ({ sent: true, summary: report.summary }))
    return { ranAt: ctx.input.triggeredAt, summary: report.summary }
  })
}

// ============================================================
// Minimal scheduler — fires every `intervalMs`. In production
// this is `node-cron`, EventBridge, Cloudflare Cron, Durable
// Object alarms, etc. Here it's a setInterval that vitest's
// fake timers drive deterministically.
// ============================================================

interface SchedulerOptions {
  intervalMs: number
  onTick: () => Promise<void> | void
}

function startScheduler(options: SchedulerOptions): () => void {
  const handle = setInterval(() => {
    void Promise.resolve(options.onTick()).catch(() => {
      /* swallow — production code routes to error tracker */
    })
  }, options.intervalMs)
  return () => clearInterval(handle)
}

// ============================================================
// Tests
// ============================================================

describe('external cron scheduling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires a fresh workflow run per tick, each with an independent runId', async () => {
    const runStore = inMemoryRunStore()
    const workflow = makeDailyReport(async () => ({ summary: 'all green' }))
    const runIds: Array<string> = []
    const finishedOutputs: Array<unknown> = []

    const stop = startScheduler({
      intervalMs: 60_000, // "every minute"
      onTick: async () => {
        const events: Array<WorkflowEvent> = []
        for await (const e of runWorkflow({
          workflow,
          input: { triggeredAt: Date.now() },
          runStore,
        })) {
          events.push(e)
        }
        const started = events.find((e) => e.type === 'RUN_STARTED')
        if (started) runIds.push((started as { runId: string }).runId)
        const finished = events.find((e) => e.type === 'RUN_FINISHED')
        if (finished) {
          finishedOutputs.push((finished as { output: unknown }).output)
        }
      },
    })

    // Advance fake time through three ticks.
    await vi.advanceTimersByTimeAsync(60_000 * 3)
    stop()
    // Drain any microtasks the last tick scheduled.
    await vi.runAllTimersAsync()

    expect(runIds).toHaveLength(3)
    expect(new Set(runIds).size).toBe(3) // all distinct
    expect(finishedOutputs).toHaveLength(3)
    for (const out of finishedOutputs) {
      expect(out).toMatchObject({ summary: 'all green' })
    }
  })

  it('skip-overlap policy: deterministic runId blocks a second tick while the first is running', async () => {
    // The scheduler holds a deterministic runId per "day." If a tick
    // fires while the previous run for the same id is still running
    // or paused, we read the run state and bail.
    const runStore = inMemoryRunStore()
    let invocations = 0
    const workFn = vi.fn(async () => {
      invocations++
      return { summary: `invocation-${invocations}` }
    })
    const workflow = makeDailyReport(workFn)

    const runIdAttempts: Array<string> = []
    const skippedAttempts: Array<string> = []

    async function tickWithSkipOverlap() {
      // One run per "minute window" in this test — production code
      // would use a day key, schedule id, etc.
      const minuteKey = Math.floor(Date.now() / 60_000)
      const runId = `daily-report:${minuteKey}`
      runIdAttempts.push(runId)

      const existing = await runStore.getRunState(runId)
      if (
        existing &&
        existing.status !== 'finished' &&
        existing.status !== 'errored'
      ) {
        skippedAttempts.push(runId)
        return
      }
      await collect(
        runWorkflow({
          workflow,
          runId,
          input: { triggeredAt: Date.now() },
          runStore,
        }),
      )
    }

    // Fire two ticks in quick succession (both within the same minute
    // window → same runId). The second one should skip because the
    // first is still resident.
    //
    // To simulate "first is still running" we fire them in parallel
    // and let the runStore's idempotency-check on getRunState catch the
    // second one — the in-memory store's deleteRun on finish runs
    // synchronously enough that we need to interleave deliberately.
    //
    // Strategy: drive two ticks concurrently, then advance time so the
    // first completes. Then a third tick (still in the same minute)
    // sees a finished run and would NOT skip — but we want skip
    // semantics for in-flight overlap.
    //
    // Easier: hold the first tick's `step` fn open by making it await
    // a manually-resolved promise.
    let releaseFirstStep: (() => void) | null = null
    workFn.mockImplementationOnce(async () => {
      invocations++
      await new Promise<void>((r) => {
        releaseFirstStep = r
      })
      return { summary: 'first' }
    })

    const tick1 = tickWithSkipOverlap()
    // Yield so tick1 progresses to inside the step fn and is "running".
    await vi.advanceTimersByTimeAsync(0)

    // Fire tick2 — same minute window, first is still running.
    const tick2 = tickWithSkipOverlap()
    await vi.advanceTimersByTimeAsync(0)

    // Release the first tick.
    releaseFirstStep!()
    await tick1
    await tick2

    expect(runIdAttempts).toHaveLength(2)
    expect(runIdAttempts[0]).toBe(runIdAttempts[1]) // same minute key
    expect(skippedAttempts).toHaveLength(1)
    expect(invocations).toBe(1) // workFn ran exactly once
  })

  it('buffer-one policy: one extra tick during a long run becomes one follow-up', async () => {
    const runStore = inMemoryRunStore()
    const completedSummaries: Array<string> = []
    let runOrder = 0

    // Hold the first run open so subsequent ticks deterministically
    // observe it as in-flight.
    let releaseFirst: (() => void) | null = null
    let firstStepStarted: (() => void) | null = null
    const firstStepStartedPromise = new Promise<void>((r) => {
      firstStepStarted = r
    })
    let firstCallHandled = false

    const heldWorkFn = vi.fn(async () => {
      const tag = `run-${++runOrder}`
      if (!firstCallHandled) {
        firstCallHandled = true
        firstStepStarted!()
        await new Promise<void>((r) => {
          releaseFirst = r
        })
      }
      return { summary: tag }
    })
    const workflow = makeDailyReport(heldWorkFn)

    let pending = false
    let inFlight: Promise<void> | null = null

    const tick = async () => {
      if (inFlight) {
        pending = true
        return
      }
      const promise = (async () => {
        const events = await collect(
          runWorkflow({
            workflow,
            input: { triggeredAt: Date.now() },
            runStore,
          }),
        )
        const out = events.find((e) => e.type === 'RUN_FINISHED') as
          | { output: { summary: string } }
          | undefined
        if (out) completedSummaries.push(out.output.summary)
      })()
      inFlight = promise.finally(async () => {
        inFlight = null
        if (pending) {
          pending = false
          await tick()
        }
      })
      await inFlight
    }

    // Fire three ticks while the first is held; only one should buffer.
    const t1 = tick()
    await firstStepStartedPromise
    const t2 = tick() // buffered as pending=true
    const t3 = tick() // collapses into existing pending (no extra)

    // Release the first; the buffered tick runs.
    releaseFirst!()
    await Promise.all([t1, t2, t3])

    // Two runs total: the held one + one buffered follow-up. The third
    // tick collapsed into the buffer.
    expect(completedSummaries).toHaveLength(2)
  })
})
