import { describe, expect, it } from 'vitest'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import { collect, findApprovalId, findRunId } from './test-utils'

describe('resume delivery matching', () => {
  it('rejects an approval delivery for a different approvalId', async () => {
    const wf = createWorkflow({ id: 'approval-match' }).handler(async (ctx) => {
      const decision = await ctx.approve({ title: 'Ship?' })
      return { approved: decision.approved }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)

    const rejected = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: { approvalId: 'wrong-approval', approved: true },
        runStore: store,
      }),
    )

    expect(rejected.find((e) => e.type === 'RUN_ERRORED')).toMatchObject({
      code: 'approval_lost',
    })

    const accepted = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: { approvalId: findApprovalId(phase1), approved: true },
        runStore: store,
      }),
    )
    expect(accepted.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { approved: true },
    })
  })

  it('rejects a signal delivery when the run is waiting for a different signal', async () => {
    const wf = createWorkflow({ id: 'signal-match' }).handler(async (ctx) => {
      const payload = await ctx.waitForEvent<{ ok: boolean }>('expected')
      return { payload }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)

    const rejected = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        signalDelivery: {
          signalId: 'wrong-1',
          name: 'wrong',
          payload: { ok: true },
        },
        runStore: store,
      }),
    )

    expect(rejected.find((e) => e.type === 'RUN_ERRORED')).toMatchObject({
      code: 'signal_lost',
    })

    const accepted = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        signalDelivery: {
          signalId: 'expected-1',
          name: 'expected',
          payload: { ok: true },
        },
        runStore: store,
      }),
    )
    expect(accepted.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { payload: { ok: true } },
    })
  })
})
