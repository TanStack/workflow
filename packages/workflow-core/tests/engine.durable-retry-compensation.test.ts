import { describe, expect, it } from 'vitest'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import { collect } from './test-utils'

describe('durable retries and compensation with the core RunStore', () => {
  it('resumes a durable retry with a legacy RunStore and a host timer delivery', async () => {
    const runStore = inMemoryRunStore()
    const attempts: number[] = []
    const workflow = createWorkflow({ id: 'retry' }).handler((ctx) =>
      ctx.step(
        'send',
        ({ attempt }) => {
          attempts.push(attempt)
          if (attempt === 1) throw new Error('unavailable')
          return 'sent'
        },
        { retry: { maxAttempts: 2, durable: true, baseMs: 1 } },
      ),
    )
    await collect(runWorkflow({ workflow, runStore, runId: 'core', input: {} }))
    expect(await runStore.getRunState('core')).toMatchObject({
      status: 'paused',
      waitingFor: { signalName: '__timer', stepId: '__retry:send:1' },
    })
    await collect(
      runWorkflow({
        workflow,
        runStore,
        runId: 'core',
        signalDelivery: {
          name: '__timer',
          signalId: 'wake',
          payload: undefined,
        },
      }),
    )
    expect(attempts).toEqual([1, 2])
    expect(await runStore.getRunState('core')).toMatchObject({
      status: 'finished',
      output: 'sent',
    })
  })

  it('does not add retry checkpoints to legacy in-process retries', async () => {
    const runStore = inMemoryRunStore()
    const workflow = createWorkflow({ id: 'legacy' }).handler((ctx) =>
      ctx.step(
        'send',
        ({ attempt }) => {
          if (attempt === 1) throw new Error('unavailable')
          return 'sent'
        },
        { retry: { maxAttempts: 2, baseMs: 0 } },
      ),
    )
    await collect(
      runWorkflow({ workflow, runStore, runId: 'legacy', input: {} }),
    )
    expect(
      (await runStore.getEvents('legacy')).map((event) => event.type),
    ).toEqual(['STEP_FINISHED', 'RUN_FINISHED'])
  })

  it('replays a legacy completed step before compensating a later failure', async () => {
    const runStore = inMemoryRunStore()
    await runStore.setRunState('legacy', {
      runId: 'legacy',
      workflowId: 'flow',
      status: 'running',
      input: {},
      createdAt: 0,
      updatedAt: 0,
    })
    await runStore.appendEvent('legacy', 0, {
      type: 'STEP_FINISHED',
      ts: 0,
      stepId: 'reserve',
      result: 'reservation-1',
    })
    let forwardCalls = 0
    const undone: string[] = []
    const workflow = createWorkflow({ id: 'flow' }).handler(async (ctx) => {
      const reservation = await ctx.step('reserve', () => {
        forwardCalls++
        return 'new'
      })
      await ctx.compensate('release', () => {
        undone.push(reservation)
      })
      throw new Error('payment failed')
    })
    await collect(
      runWorkflow({ workflow, runStore, runId: 'legacy', recover: true }),
    )
    expect(forwardCalls).toBe(0)
    expect(undone).toEqual(['reservation-1'])
    expect(await runStore.getRunState('legacy')).toMatchObject({
      status: 'errored',
      error: { message: 'payment failed' },
    })
  })
})
