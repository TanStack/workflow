import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import { collect, findRunId, simulateRestart } from './test-utils'

describe('ctx.waitForEvent()', () => {
  it('pauses with waitingFor set and emits SIGNAL_AWAITED', async () => {
    const wf = createWorkflow({
      id: 'webhook-wait',
      output: z.object({ payload: z.any() }),
    }).handler(async (ctx) => {
      const payload = await ctx.waitForEvent<{ ok: boolean }>(
        'webhook-received',
        { meta: { source: 'stripe' } },
      )
      return { payload }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)

    // Stream closed before RUN_FINISHED — we paused.
    expect(phase1.map((e) => e.type)).not.toContain('RUN_FINISHED')

    const awaited = phase1.find((e) => e.type === 'SIGNAL_AWAITED')
    expect(awaited).toMatchObject({
      name: 'webhook-received',
      meta: { source: 'stripe' },
    })

    const runState = await store.getRunState(runId)
    expect(runState?.status).toBe('paused')
    expect(runState?.waitingFor?.signalName).toBe('webhook-received')
    expect(runState?.waitingFor?.meta).toEqual({ source: 'stripe' })
  })

  it('delivers the payload via in-memory resume', async () => {
    const wf = createWorkflow({
      id: 'signal-passthrough',
      output: z.object({ payload: z.any() }),
    }).handler(async (ctx) => {
      const payload = await ctx.waitForEvent<{ ok: boolean; n: number }>('thing')
      return { payload }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        signalDelivery: {
          signalId: 'sig-1',
          name: 'thing',
          payload: { ok: true, n: 42 },
        },
        runStore: store,
      }),
    )

    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { payload: { ok: true, n: 42 } },
    })
  })

  it('delivers the same payload via replay after a process restart', async () => {
    const wf = createWorkflow({
      id: 'signal-replay',
      output: z.object({ payload: z.any() }),
    }).handler(async (ctx) => {
      const payload = await ctx.waitForEvent<{ ok: boolean }>('thing')
      return { payload }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)

    simulateRestart(store)

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        signalDelivery: {
          signalId: 'sig-1',
          name: 'thing',
          payload: { ok: true },
        },
        runStore: store,
      }),
    )

    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { payload: { ok: true } },
    })
  })

  it('validates the payload against the optional schema', async () => {
    const wf = createWorkflow({
      id: 'signal-schema',
      output: z.object({ ok: z.boolean() }),
    }).handler(async (ctx) => {
      const payload = await ctx.waitForEvent('approve', {
        schema: z.object({ approved: z.boolean(), notes: z.string() }),
      })
      return { ok: payload.approved }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        signalDelivery: {
          signalId: 'sig-1',
          name: 'approve',
          payload: { approved: true, notes: 'lgtm' },
        },
        runStore: store,
      }),
    )

    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { ok: true },
    })
  })
})

describe('ctx.sleep() / ctx.sleepUntil()', () => {
  it('pauses on the __timer signal with the deadline plumbed through', async () => {
    const wakeAt = Date.now() + 60_000

    const wf = createWorkflow({ id: 'sleep-until' }).handler(async (ctx) => {
      await ctx.sleepUntil(wakeAt)
      return {}
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)

    const runState = await store.getRunState(runId)
    expect(runState?.waitingFor?.signalName).toBe('__timer')
    expect(runState?.waitingFor?.deadline).toBe(wakeAt)

    const awaited = phase1.find((e) => e.type === 'SIGNAL_AWAITED')
    expect(awaited).toMatchObject({ name: '__timer', deadline: wakeAt })
  })

  it('resumes when the host delivers a __timer signal (void payload)', async () => {
    const wf = createWorkflow({
      id: 'sleep-then-done',
      output: z.object({ awoke: z.boolean() }),
    }).handler(async (ctx) => {
      await ctx.sleep(60_000)
      return { awoke: true }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        signalDelivery: {
          signalId: 'wake-1',
          name: '__timer',
          payload: undefined,
        },
        runStore: store,
      }),
    )

    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { awoke: true },
    })
  })
})
