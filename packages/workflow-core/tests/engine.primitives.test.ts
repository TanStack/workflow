import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import {
  collect,
  findApprovalId,
  findRunId,
  simulateRestart,
} from './test-utils'

describe('ctx.step()', () => {
  it('runs fn once and persists STEP_FINISHED with the result', async () => {
    let callCount = 0
    const wf = createWorkflow({ id: 'step-once' }).handler(async (ctx) => {
      const data = await ctx.step('fetch', () => {
        callCount++
        return 'hello'
      })
      await ctx.approve({ title: 'go?' })
      return { data }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)
    expect(callCount).toBe(1)

    const log = await store.getEvents(runId)
    const finished = log.find((e) => e.type === 'STEP_FINISHED')
    expect(finished).toMatchObject({ stepId: 'fetch', result: 'hello' })
  })

  it('passes a deterministic ctx.id to fn', async () => {
    const idsSeen: Array<string> = []
    const wf = createWorkflow({ id: 'step-ctx-id' }).handler(async (ctx) => {
      await ctx.step('a', (stepCtx) => {
        idsSeen.push(stepCtx.id)
        return 1
      })
      await ctx.step('b', (stepCtx) => {
        idsSeen.push(stepCtx.id)
        return 2
      })
      return {}
    })

    await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )

    expect(idsSeen).toHaveLength(2)
    expect(idsSeen[0]).toMatch(/:a$/)
    expect(idsSeen[1]).toMatch(/:b$/)
    expect(idsSeen[0]).not.toBe(idsSeen[1])
  })

  it('does NOT re-execute fn on replay', async () => {
    let callCount = 0
    const wf = createWorkflow({ id: 'step-replay' }).handler(async (ctx) => {
      const data = await ctx.step('fetch', () => {
        callCount++
        return 'world'
      })
      await ctx.approve({ title: 'go?' })
      return { data }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)
    expect(callCount).toBe(1)

    simulateRestart(store)

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: { approvalId: findApprovalId(phase1), approved: true },
        runStore: store,
      }),
    )

    expect(callCount).toBe(1)
    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { data: 'world' },
    })
  })

  it('persists thrown errors as STEP_FAILED and rethrows on replay', async () => {
    let callCount = 0
    const wf = createWorkflow({
      id: 'step-throws',
      output: z.object({ caught: z.boolean() }),
    }).handler(async (ctx) => {
      let caught = false
      try {
        await ctx.step('boom', () => {
          callCount++
          throw new Error('kaboom')
        })
      } catch (err) {
        caught = err instanceof Error && err.message === 'kaboom'
      }
      await ctx.approve({ title: 'go?' })
      return { caught }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)
    expect(callCount).toBe(1)

    const log = await store.getEvents(runId)
    const failed = log.find((e) => e.type === 'STEP_FAILED')
    expect(failed).toMatchObject({
      stepId: 'boom',
      error: { message: 'kaboom' },
    })

    simulateRestart(store)

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: { approvalId: findApprovalId(phase1), approved: true },
        runStore: store,
      }),
    )

    // Replay rethrows the recorded error so user-side try/catch still
    // observes `caught`. fn is NOT re-invoked.
    expect(callCount).toBe(1)
    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { caught: true },
    })
  })
})

describe('ctx.now()', () => {
  it('records Date.now() once and replay sees the same value', async () => {
    const wf = createWorkflow({
      id: 'now-replay',
      output: z.object({ ts: z.number() }),
    }).handler(async (ctx) => {
      const ts = await ctx.now()
      await ctx.approve({ title: 'go?' })
      return { ts }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)
    const log = await store.getEvents(runId)
    const recorded = log.find((e) => e.type === 'NOW_RECORDED')
    expect(recorded).toBeDefined()
    const recordedTs = (
      recorded as Extract<(typeof log)[number], { type: 'NOW_RECORDED' }>
    ).value

    simulateRestart(store)

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: { approvalId: findApprovalId(phase1), approved: true },
        runStore: store,
      }),
    )

    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { ts: recordedTs },
    })
  })

  it('matches explicit ids instead of call order on replay', async () => {
    const wfV1 = createWorkflow({
      id: 'now-explicit-id',
      version: 'v1',
      output: z.object({ first: z.number(), second: z.number() }),
    }).handler(async (ctx) => {
      const first = await ctx.now({ id: 'first-timestamp' })
      const second = await ctx.now({ id: 'second-timestamp' })
      await ctx.approve({ id: 'gate', title: 'go?' })
      return { first, second }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wfV1, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)
    const log = await store.getEvents(runId)
    const firstRecorded = log.find(
      (e) => e.type === 'NOW_RECORDED' && e.stepId === 'first-timestamp',
    ) as Extract<(typeof log)[number], { type: 'NOW_RECORDED' }>
    const secondRecorded = log.find(
      (e) => e.type === 'NOW_RECORDED' && e.stepId === 'second-timestamp',
    ) as Extract<(typeof log)[number], { type: 'NOW_RECORDED' }>

    const wfV1Reordered = createWorkflow({
      id: 'now-explicit-id',
      version: 'v1',
      output: z.object({ first: z.number(), second: z.number() }),
    }).handler(async (ctx) => {
      const second = await ctx.now({ id: 'second-timestamp' })
      await ctx.approve({ id: 'gate', title: 'go?' })
      const first = await ctx.now({ id: 'first-timestamp' })
      return { first, second }
    })

    const phase2 = await collect(
      runWorkflow({
        workflow: wfV1Reordered,
        runId,
        approval: { approvalId: findApprovalId(phase1), approved: true },
        runStore: store,
      }),
    )

    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: {
        first: firstRecorded.value,
        second: secondRecorded.value,
      },
    })
  })
})

describe('ctx.uuid()', () => {
  it('records a fresh UUID once and replay sees the same value', async () => {
    const wf = createWorkflow({
      id: 'uuid-replay',
      output: z.object({ id: z.string() }),
    }).handler(async (ctx) => {
      const id = await ctx.uuid()
      await ctx.approve({ title: 'go?' })
      return { id }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)
    const log = await store.getEvents(runId)
    const recorded = log.find((e) => e.type === 'UUID_RECORDED')
    expect(recorded).toBeDefined()
    const recordedId = (
      recorded as Extract<(typeof log)[number], { type: 'UUID_RECORDED' }>
    ).value
    expect(recordedId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )

    simulateRestart(store)

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: { approvalId: findApprovalId(phase1), approved: true },
        runStore: store,
      }),
    )

    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { id: recordedId },
    })
  })
})

describe('ctx.approve()', () => {
  it('persists explicit durable ids and metadata', async () => {
    const wf = createWorkflow({ id: 'approve-id-meta' }).handler(
      async (ctx) => {
        const decision = await ctx.approve({
          id: 'legal-review',
          title: 'Ship?',
          meta: { assignee: 'legal' },
        })
        return { approved: decision.approved }
      },
    )

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)
    const requested = phase1.find((e) => e.type === 'APPROVAL_REQUESTED')
    expect(requested).toMatchObject({
      stepId: 'legal-review',
      meta: { assignee: 'legal' },
    })

    const runState = await store.getRunState(runId)
    expect(runState?.awaiting).toEqual([
      {
        type: 'approval',
        stepId: 'legal-review',
        approvalId: findApprovalId(phase1),
        title: 'Ship?',
        meta: { assignee: 'legal' },
      },
    ])
    expect(runState?.pendingApproval).toMatchObject({
      stepId: 'legal-review',
      meta: { assignee: 'legal' },
    })

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: { approvalId: findApprovalId(phase1), approved: true },
        runStore: store,
      }),
    )

    expect(phase2.find((e) => e.type === 'APPROVAL_RESOLVED')).toMatchObject({
      stepId: 'legal-review',
    })
    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { approved: true },
    })
  })
})
