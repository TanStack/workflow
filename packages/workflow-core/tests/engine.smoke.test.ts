import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import { collect, findRunId } from './test-utils'

describe('engine smoke', () => {
  it('runs a single-step workflow end-to-end', async () => {
    const wf = createWorkflow({
      id: 'echo',
      input: z.object({ msg: z.string() }),
    }).handler(async (ctx) => {
      const echoed = await ctx.step('echo', () => ctx.input.msg.toUpperCase())
      return { echoed }
    })

    const events = await collect(
      runWorkflow({
        workflow: wf,
        input: { msg: 'hello' },
        runStore: inMemoryRunStore(),
      }),
    )

    const types = events.map((e) => e.type)
    expect(types).toContain('RUN_STARTED')
    expect(types).toContain('STEP_STARTED')
    expect(types).toContain('STEP_FINISHED')
    expect(types).toContain('RUN_FINISHED')

    const finished = events.find((e) => e.type === 'RUN_FINISHED')
    expect(finished).toMatchObject({ output: { echoed: 'HELLO' } })

    const stepFinished = events.find((e) => e.type === 'STEP_FINISHED')
    expect(stepFinished).toMatchObject({ stepId: 'echo', result: 'HELLO' })
  })

  it('emits STATE_DELTA on state mutations between primitives', async () => {
    const wf = createWorkflow({
      id: 'state-wf',
      state: z.object({ counter: z.number().default(0) }),
    }).handler(async (ctx) => {
      const v = await ctx.step('compute', () => 42)
      ctx.state.counter = v
      // A second step so the delta has a flush boundary after the
      // mutation.
      await ctx.step('noop', () => null)
      return {}
    })

    const events = await collect(
      runWorkflow({
        workflow: wf,
        input: {},
        runStore: inMemoryRunStore(),
      }),
    )

    const delta = events.find((e) => e.type === 'STATE_DELTA')
    expect(delta).toMatchObject({
      delta: expect.arrayContaining([
        expect.objectContaining({
          op: 'replace',
          path: '/counter',
          value: 42,
        }),
      ]),
    })
  })

  it('pauses on approval — stream ends without RUN_FINISHED', async () => {
    const wf = createWorkflow({
      id: 'approval-wf',
    }).handler(async (ctx) => {
      const d = await ctx.approve({ title: 'go?' })
      return { ok: d.approved }
    })

    const store = inMemoryRunStore()
    const events = await collect(
      runWorkflow({
        workflow: wf,
        input: {},
        runStore: store,
      }),
    )

    const types = events.map((e) => e.type)
    expect(types).toContain('APPROVAL_REQUESTED')
    expect(types).not.toContain('RUN_FINISHED')

    const runId = findRunId(events)
    const runState = await store.getRunState(runId)
    expect(runState).toMatchObject({
      status: 'paused',
      pendingApproval: { title: 'go?' },
    })
  })

  it('propagates a pre-aborted external signal into the step abort signal', async () => {
    let observedAborted: boolean | null = null

    const wf = createWorkflow({ id: 'pre-aborted' }).handler(async (ctx) => {
      const r = await ctx.step('observe', (stepCtx) => {
        observedAborted = stepCtx.signal.aborted
        return { ok: true }
      })
      return r
    })

    const ac = new AbortController()
    ac.abort()
    await collect(
      runWorkflow({
        workflow: wf,
        input: {},
        runStore: inMemoryRunStore(),
        signal: ac.signal,
      }),
    )

    expect(observedAborted).toBe(true)
  })
})
