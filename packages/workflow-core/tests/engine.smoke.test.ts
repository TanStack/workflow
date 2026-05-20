import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  approve,
  defineWorkflow,
  inMemoryRunStore,
  runWorkflow,
  step,
} from '../src'
import { collect, findRunId } from './test-utils'

describe('engine smoke', () => {
  it('runs a single-step workflow end-to-end', async () => {
    const wf = defineWorkflow({
      name: 'echo-wf',
      input: z.object({ msg: z.string() }),
      output: z.object({ echoed: z.string() }),
      state: z.object({}).default({}),
      run: async function* ({ input }) {
        const echoed = yield* step('echo', () => input.msg.toUpperCase())
        return { echoed }
      },
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
    expect(types).toContain('STATE_SNAPSHOT')
    expect(types).toContain('STEP_STARTED')
    expect(types).toContain('STEP_FINISHED')
    expect(types).toContain('RUN_FINISHED')

    expect(events.find((e) => e.type === 'STEP_FINISHED')).toMatchObject({
      content: 'HELLO',
    })
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { echoed: 'HELLO' },
    })
  })

  it('emits STATE_DELTA on state mutations between yields', async () => {
    const wf = defineWorkflow({
      name: 'state-wf',
      input: z.object({}).default({}),
      output: z.object({}).default({}),
      state: z.object({ counter: z.number().default(0) }),
      run: async function* ({ state }) {
        const v = yield* step('compute', () => 42)
        state.counter = v
        return {}
      },
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

  it('pauses on approval — stream ends after approval-requested, RUN_FINISHED not emitted', async () => {
    const wf = defineWorkflow({
      name: 'approval-wf',
      input: z.object({}).default({}),
      output: z.object({ ok: z.boolean() }),
      state: z.object({}).default({}),
      run: async function* () {
        const d = yield* approve({ title: 'go?' })
        return { ok: d.approved }
      },
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
    expect(types).toContain('STEP_STARTED')
    expect(
      events.some(
        (e) =>
          e.type === 'CUSTOM' &&
          (e as { name?: string }).name === 'approval-requested',
      ),
    ).toBe(true)
    // Stream ended at the approval pause.
    expect(types).not.toContain('RUN_FINISHED')

    // Verify the persisted RunState reflects the paused approval.
    const runId = findRunId(events)
    const runState = await store.getRunState(runId)
    expect(runState).toMatchObject({
      status: 'paused',
      pendingApproval: { title: 'go?' },
    })
  })

  it('propagates a pre-aborted external signal into the step abort signal', async () => {
    // Per the addEventListener('abort', ...) contract, listeners don't
    // fire for the already-aborted state. The engine has to check the
    // signal explicitly at start; otherwise `step` fns see a fresh,
    // non-aborted signal even though the caller cancelled.
    let observedAborted: boolean | null = null

    const wf = defineWorkflow({
      name: 'pre-aborted',
      input: z.object({}).default({}),
      output: z.object({ ok: z.boolean() }),
      state: z.object({}).default({}),
      run: async function* () {
        const r = yield* step('observe', (ctx) => {
          observedAborted = ctx.signal.aborted
          return { ok: true }
        })
        return r
      },
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
    // Without the eager-abort check, observedAborted would be false here —
    // addEventListener never fires for an already-aborted signal.
    expect(observedAborted).toBe(true)
  })
})
