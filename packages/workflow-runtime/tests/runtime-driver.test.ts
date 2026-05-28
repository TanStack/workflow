import { describe, expect, it } from 'vitest'
import { createWorkflow } from '@tanstack/workflow-core'
import { defineWorkflowRuntime, inMemoryWorkflowExecutionStore } from '../src'

describe('workflow runtime driver', () => {
  it('starts a run through the registry and does not re-execute duplicate run IDs', async () => {
    const store = inMemoryWorkflowExecutionStore()
    let executions = 0
    const workflow = createWorkflow({ id: 'counter' }).handler(async (ctx) => {
      const count = await ctx.step('count', () => {
        executions++
        return executions
      })
      return { count }
    })
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        counter: {
          load: async () => {
            await Promise.resolve()
            return workflow
          },
        },
      },
    })

    const first = await runtime.startRun({
      workflowId: 'counter',
      runId: 'counter:1',
      input: {},
      now: 0,
    })
    const second = await runtime.startRun({
      workflowId: 'counter',
      runId: 'counter:1',
      input: {},
      now: 1,
    })

    expect(first.kind).toBe('completed')
    expect(second.kind).toBe('not-claimable')
    expect(executions).toBe(1)
  })

  it('can summarize runs without retaining every emitted event', async () => {
    const store = inMemoryWorkflowExecutionStore()
    const workflow = createWorkflow({ id: 'summary' }).handler(async (ctx) => {
      const value = await ctx.step('value', () => 42)
      return { value }
    })
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        summary: {
          load: async () => {
            await Promise.resolve()
            return workflow
          },
        },
      },
    })

    const withoutEvents = await runtime.startRun({
      workflowId: 'summary',
      runId: 'summary:without-events',
      input: {},
      now: 0,
      includeEvents: false,
    })
    const cappedEvents = await runtime.startRun({
      workflowId: 'summary',
      runId: 'summary:capped-events',
      input: {},
      now: 0,
      maxEvents: 1,
    })

    expect(withoutEvents.kind).toBe('completed')
    expect(withoutEvents.eventCount).toBeGreaterThan(0)
    expect(withoutEvents.events).toEqual([])
    expect(cappedEvents.kind).toBe('completed')
    expect(cappedEvents.eventCount).toBeGreaterThan(1)
    expect(cappedEvents.events).toHaveLength(1)
    expect(cappedEvents.eventsTruncated).toBe(true)
  })

  it('delivers a signal and resumes a paused workflow', async () => {
    const store = inMemoryWorkflowExecutionStore()
    const workflow = createWorkflow({ id: 'signal' }).handler(async (ctx) => {
      return ctx.waitForEvent<{ ok: boolean }>('done')
    })
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        signal: {
          load: async () => {
            await Promise.resolve()
            return workflow
          },
        },
      },
    })

    const start = await runtime.startRun({
      workflowId: 'signal',
      runId: 'signal:1',
      input: {},
      now: 0,
    })
    const resumed = await runtime.deliverSignal({
      runId: 'signal:1',
      signalId: 'signal-1',
      name: 'done',
      payload: { ok: true },
      now: 10,
    })

    expect(start.kind).toBe('paused')
    expect(resumed.kind).toBe('completed')
    expect(
      resumed.events.find((event) => event.type === 'RUN_FINISHED'),
    ).toMatchObject({
      output: { ok: true },
    })
  })

  it('sweeps due timers and resumes sleeping workflows', async () => {
    const store = inMemoryWorkflowExecutionStore()
    const workflow = createWorkflow({ id: 'timer' }).handler(async (ctx) => {
      await ctx.sleepUntil(100)
      return { awoke: true }
    })
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        timer: {
          load: async () => {
            await Promise.resolve()
            return workflow
          },
        },
      },
    })

    const start = await runtime.startRun({
      workflowId: 'timer',
      runId: 'timer:1',
      input: {},
      now: 0,
    })
    const early = await runtime.sweep({ now: 99 })
    const due = await runtime.sweep({ now: 100 })

    expect(start.kind).toBe('paused')
    expect(early.timers).toEqual([])
    expect(due.timers).toHaveLength(1)
    expect(due.timers[0]?.kind).toBe('completed')
  })

  it('sweeps due schedule buckets into deterministic runs', async () => {
    const store = inMemoryWorkflowExecutionStore()
    const workflow = createWorkflow({ id: 'scheduled' }).handler(
      async (ctx) => {
        await Promise.resolve()
        return { input: ctx.input }
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        scheduled: {
          load: async () => {
            await Promise.resolve()
            return workflow
          },
        },
      },
    })
    await store.upsertSchedule({
      scheduleId: 'scheduled-every-15',
      workflowId: 'scheduled',
      schedule: { kind: 'interval', everyMs: 15 * 60 * 1000 },
      overlapPolicy: 'skip',
      input: { triggeredAt: 900_000 },
      nextFireAt: 900_000,
      enabled: true,
      now: 0,
    })

    const first = await runtime.sweep({ now: 900_000, leaseOwner: 'sweep-a' })
    const second = await runtime.sweep({ now: 900_000, leaseOwner: 'sweep-b' })

    expect(first.scheduled).toHaveLength(1)
    expect(first.scheduled[0]).toMatchObject({
      kind: 'completed',
      runId: 'scheduled:scheduled-every-15:900000',
    })
    expect(second.scheduled).toEqual([])
  })

  it('bounds schedule sweeps and reports summary counts', async () => {
    const store = inMemoryWorkflowExecutionStore()
    const workflow = createWorkflow({ id: 'bounded' }).handler(async (ctx) => {
      await Promise.resolve()
      return { input: ctx.input }
    })
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        bounded: {
          load: async () => {
            await Promise.resolve()
            return workflow
          },
        },
      },
    })
    for (const scheduleId of ['bounded-a', 'bounded-b']) {
      await store.upsertSchedule({
        scheduleId,
        workflowId: 'bounded',
        schedule: { kind: 'interval', everyMs: 15 * 60 * 1000 },
        overlapPolicy: 'skip',
        input: { scheduleId },
        nextFireAt: 900_000,
        enabled: true,
        now: 0,
      })
    }

    const first = await runtime.sweep({
      now: 900_000,
      leaseOwner: 'sweep-a',
      maxScheduledRuns: 1,
      includeEvents: false,
    })
    const second = await runtime.sweep({
      now: 900_000,
      leaseOwner: 'sweep-b',
      maxScheduledRuns: 1,
      includeEvents: false,
    })

    expect(first.scheduled).toHaveLength(1)
    expect(first.scheduled[0]?.events).toEqual([])
    expect(first.summary.scheduled.completed).toBe(1)
    expect(first.summary.eventCount).toBeGreaterThan(0)
    expect(first.summary.returnedEventCount).toBe(0)
    expect(first.remainingMayExist).toBe(true)
    expect(second.scheduled).toHaveLength(1)
    expect(second.summary.scheduled.completed).toBe(1)
  })

  it('reports not-claimable when another worker owns the run lease', async () => {
    const store = inMemoryWorkflowExecutionStore()
    const workflow = createWorkflow({ id: 'leased' }).handler(async () => {
      await Promise.resolve()
      return {}
    })
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        leased: {
          load: async () => {
            await Promise.resolve()
            return workflow
          },
        },
      },
    })
    await store.createRun({
      runId: 'leased:1',
      workflowId: 'leased',
      input: {},
      now: 0,
    })
    await store.claimRun({
      runId: 'leased:1',
      leaseOwner: 'worker-a',
      leaseMs: 100,
      now: 0,
    })

    const result = await runtime.startRun({
      workflowId: 'leased',
      runId: 'leased:1',
      input: {},
      leaseOwner: 'worker-b',
      now: 10,
    })

    expect(result.kind).toBe('not-claimable')
  })
})
