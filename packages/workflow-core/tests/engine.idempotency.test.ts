import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import { collect, findRunId, simulateRestart } from './test-utils'

describe('signal delivery idempotency', () => {
  it('same signalId on two deliveries is a no-op (run still completes once)', async () => {
    const wf = createWorkflow({
      id: 'idem',
      output: z.object({ payload: z.any() }),
    }).handler(async (ctx) => {
      const payload = await ctx.waitForEvent('approval', {})
      return { payload }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)

    const first = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        signalDelivery: {
          signalId: 'sig-A',
          name: 'approval',
          payload: { ok: true },
        },
        runStore: store,
      }),
    )
    expect(first.find((e) => e.type === 'RUN_FINISHED')).toBeDefined()

    // Replay the SAME signalId. After the run finished + was cleaned
    // up, the second delivery sees no run state, which surfaces as
    // run_lost. Demonstrates that the same signalId doesn't double-
    // resolve.
    const second = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        signalDelivery: {
          signalId: 'sig-A',
          name: 'approval',
          payload: { ok: true },
        },
        runStore: store,
      }),
    )
    expect(second.find((e) => e.type === 'RUN_ERRORED')).toMatchObject({
      code: 'run_lost',
    })
  })

  it('two different signalIds racing for the same pause: first wins, second is lost', async () => {
    const wf = createWorkflow({
      id: 'lost-race',
      output: z.object({ payload: z.any() }),
    }).handler(async (ctx) => {
      const payload = await ctx.waitForEvent('approval', {})
      return { payload }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)

    // First delivery completes the run.
    await collect(
      runWorkflow({
        workflow: wf,
        runId,
        signalDelivery: {
          signalId: 'sig-A',
          name: 'approval',
          payload: { winner: true },
        },
        runStore: store,
      }),
    )

    // Re-pause to set up the race scenario via a fresh start.
    const store2 = inMemoryRunStore()
    const phase2start = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store2 }),
    )
    const runId2 = findRunId(phase2start)
    // Pretend the log already has a SIGNAL_RESOLVED for this name
    // (from a separate writer) by appending it directly.
    const log = await store2.getEvents(runId2)
    await store2.appendEvent(runId2, log.length, {
      type: 'SIGNAL_RESOLVED',
      ts: Date.now(),
      stepId: '__resolve-approval',
      name: 'approval',
      signalId: 'first-writer',
      payload: { winner: true },
    })
    simulateRestart(store2)

    // Now a different signalId tries to deliver — it should lose.
    const losingDelivery = await collect(
      runWorkflow({
        workflow: wf,
        runId: runId2,
        signalDelivery: {
          signalId: 'sig-second',
          name: 'approval',
          payload: { winner: false },
        },
        runStore: store2,
      }),
    )

    expect(losingDelivery.find((e) => e.type === 'RUN_ERRORED')).toMatchObject({
      code: 'signal_lost',
    })
  })
})
