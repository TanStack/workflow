import { describe, expect, it, vi } from 'vitest'
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

  it('publishes live events without retaining them in the result', async () => {
    const store = inMemoryWorkflowExecutionStore()
    const releaseStep = deferred<void>()
    const stepPublished = deferred<void>()
    const configuredEvents: Array<string> = []
    const requestedEvents: Array<string> = []
    const workflow = createWorkflow({ id: 'live-events' }).handler(
      async (ctx) => {
        return ctx.step('slow-step', async () => {
          await releaseStep.promise
          return { done: true }
        })
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      publish: (_runId, event) => {
        configuredEvents.push(event.type)
      },
      workflows: {
        'live-events': { load: async () => workflow },
      },
    })

    let settled = false
    const runPromise = runtime
      .startRun({
        workflowId: 'live-events',
        runId: 'live-events:1',
        input: {},
        includeEvents: false,
        publish: (_runId, event) => {
          requestedEvents.push(event.type)
          if (event.type === 'STEP_STARTED') stepPublished.resolve()
        },
      })
      .finally(() => {
        settled = true
      })

    await stepPublished.promise
    expect(settled).toBe(false)
    expect(configuredEvents).toContain('STEP_STARTED')
    expect(requestedEvents).toContain('STEP_STARTED')

    releaseStep.resolve()
    const result = await runPromise

    expect(result.kind).toBe('completed')
    expect(result.events).toEqual([])
    expect(configuredEvents).toContain('RUN_FINISHED')
    expect(requestedEvents).toContain('RUN_FINISHED')
  })

  it('exposes runtime deadline helpers on handler and step contexts', async () => {
    const store = inMemoryWorkflowExecutionStore()
    const deadline = Date.now() + 60_000
    const workflow = createWorkflow({ id: 'deadline-context' }).handler(
      async (ctx) => {
        return ctx.step('read-deadline', (stepCtx) => ({
          handlerDeadline: ctx.runtime.deadline,
          stepDeadline: stepCtx.runtime.deadline,
          handlerRemaining: ctx.runtime.timeRemaining(),
          stepRemaining: stepCtx.runtime.timeRemaining(),
          shouldYieldWithSmallBuffer: ctx.runtime.shouldYield({
            minRemainingMs: 1,
          }),
          shouldYieldWithLargeBuffer: stepCtx.runtime.shouldYield({
            minRemainingMs: 120_000,
          }),
        }))
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        'deadline-context': {
          load: async () => {
            await Promise.resolve()
            return workflow
          },
        },
      },
    })

    const result = await runtime.startRun({
      workflowId: 'deadline-context',
      runId: 'deadline-context:1',
      input: {},
      deadline,
    })

    expect(result.kind).toBe('completed')
    expect(result.run?.output).toMatchObject({
      handlerDeadline: deadline,
      stepDeadline: deadline,
      shouldYieldWithSmallBuffer: false,
      shouldYieldWithLargeBuffer: true,
    })
    expect(
      (result.run?.output as { handlerRemaining?: number }).handlerRemaining,
    ).toBeGreaterThan(0)
    expect(
      (result.run?.output as { stepRemaining?: number }).stepRemaining,
    ).toBeGreaterThan(0)
  })

  it('explicit yield persists, releases the lease, and resumes on a later sweep', async () => {
    const store = inMemoryWorkflowExecutionStore()
    let executions = 0
    const workflow = createWorkflow({ id: 'manual-yield' }).handler(
      async (ctx) => {
        const first = await ctx.step('first', () => ++executions)
        await ctx.runtime.yield({ reason: 'manual' })
        const second = await ctx.step('second', () => ++executions)
        return { first, second }
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        'manual-yield': {
          load: async () => {
            await Promise.resolve()
            return workflow
          },
        },
      },
    })

    const start = await runtime.startRun({
      workflowId: 'manual-yield',
      runId: 'manual-yield:1',
      input: {},
      now: 100,
      leaseOwner: 'worker-a',
    })
    const yielded = await store.loadRun('manual-yield:1')
    const resumed = await runtime.sweep({
      now: 101,
      leaseOwner: 'worker-b',
    })

    expect(start.kind).toBe('paused')
    expect(yielded).toMatchObject({
      status: 'paused',
      lease: undefined,
      waitingFor: { signalName: '__timer', deadline: 101 },
    })
    expect(resumed.timers[0]).toMatchObject({
      kind: 'completed',
      runId: 'manual-yield:1',
    })
    expect(resumed.timers[0]?.run?.output).toEqual({ first: 1, second: 2 })
    expect(executions).toBe(2)
  })

  it('does not turn a yielded run back into a stale running row on duplicate start', async () => {
    const store = inMemoryWorkflowExecutionStore()
    const workflow = createWorkflow({ id: 'yield-retry' }).handler(
      async (ctx) => {
        await ctx.runtime.yield()
        return { done: true }
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        'yield-retry': { load: async () => workflow },
      },
    })

    const first = await runtime.startRun({
      workflowId: 'yield-retry',
      runId: 'yield-retry:1',
      input: {},
      now: 100,
    })
    const duplicate = await runtime.startRun({
      workflowId: 'yield-retry',
      runId: 'yield-retry:1',
      input: {},
      now: 100,
    })

    expect(first.kind).toBe('paused')
    expect(duplicate.kind).toBe('not-claimable')
    expect(await store.loadRun('yield-retry:1')).toMatchObject({
      status: 'paused',
      lease: undefined,
    })
  })

  it('releases the lease when scheduling a yielded run fails', async () => {
    const store = inMemoryWorkflowExecutionStore()
    store.scheduleTimer = async () => {
      throw new Error('timer store unavailable')
    }
    const workflow = createWorkflow({ id: 'yield-schedule-failure' }).handler(
      async (ctx) => {
        await ctx.runtime.yield()
        return {}
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        'yield-schedule-failure': { load: async () => workflow },
      },
    })

    await expect(
      runtime.startRun({
        workflowId: 'yield-schedule-failure',
        runId: 'yield-schedule-failure:1',
        input: {},
        now: 100,
      }),
    ).rejects.toThrow('timer store unavailable')

    expect(await store.loadRun('yield-schedule-failure:1')).toMatchObject({
      status: 'paused',
      lease: undefined,
    })
  })

  it('automatically yields before fresh step work when the runtime deadline is exhausted', async () => {
    const store = inMemoryWorkflowExecutionStore()
    let executions = 0
    const workflow = createWorkflow({ id: 'auto-yield' }).handler(
      async (ctx) => {
        const value = await ctx.step('fresh-work', () => ++executions)
        return { value }
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        'auto-yield': {
          load: async () => {
            await Promise.resolve()
            return workflow
          },
        },
      },
    })

    const start = await runtime.startRun({
      workflowId: 'auto-yield',
      runId: 'auto-yield:1',
      input: {},
      now: 200,
      deadline: Date.now() - 1,
      leaseOwner: 'worker-a',
    })
    const yielded = await store.loadRun('auto-yield:1')

    expect(start.kind).toBe('paused')
    expect(executions).toBe(0)
    expect(yielded).toMatchObject({
      status: 'paused',
      lease: undefined,
      waitingFor: { signalName: '__timer', deadline: 201 },
    })

    const resumed = await runtime.sweep({
      now: 201,
      deadline: Date.now() + 60_000,
      leaseOwner: 'worker-b',
    })

    expect(resumed.timers[0]?.kind).toBe('completed')
    expect(resumed.timers[0]?.run?.output).toEqual({ value: 1 })
    expect(executions).toBe(1)
  })

  it('stays paused when workflow code catches the automatic yield sentinel', async () => {
    const store = inMemoryWorkflowExecutionStore()
    let executions = 0
    let caught = 0
    const workflow = createWorkflow({ id: 'caught-auto-yield' }).handler(
      async (ctx) => {
        try {
          await ctx.step('work', () => {
            executions++
            return 'done'
          })
        } catch {
          caught++
        }
        return 'completed'
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        'caught-auto-yield': { load: async () => workflow },
      },
    })

    const paused = await runtime.startRun({
      workflowId: 'caught-auto-yield',
      runId: 'caught-auto-yield:1',
      input: {},
      now: 100,
      deadline: Date.now() - 1,
    })

    expect(paused.kind).toBe('paused')
    expect(executions).toBe(0)
    expect(caught).toBe(1)

    const resumed = await runtime.sweep({
      now: 101,
      deadline: Date.now() + 60_000,
    })

    expect(resumed.timers[0]?.kind).toBe('completed')
    expect(resumed.timers[0]?.run?.output).toBe('completed')
    expect(executions).toBe(1)
    expect(caught).toBe(1)
  })

  it('keeps automatic and explicit yield checkpoints independent', async () => {
    const store = inMemoryWorkflowExecutionStore()
    let executions = 0
    const workflow = createWorkflow({ id: 'mixed-yield' }).handler(
      async (ctx) => {
        const first = await ctx.step('first', () => ++executions)
        await ctx.runtime.yield({ reason: 'manual' })
        const second = await ctx.step('second', () => ++executions)
        return { first, second }
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        'mixed-yield': {
          load: async () => workflow,
        },
      },
    })

    const automaticYield = await runtime.startRun({
      workflowId: 'mixed-yield',
      runId: 'mixed-yield:1',
      input: {},
      now: 300,
      deadline: Date.now() - 1,
    })
    const explicitYield = await runtime.sweep({
      now: 301,
      deadline: Date.now() + 60_000,
    })

    expect(automaticYield.kind).toBe('paused')
    expect(explicitYield.timers[0]?.kind).toBe('paused')
    expect(executions).toBe(1)

    const completed = await runtime.sweep({
      now: 302,
      deadline: Date.now() + 60_000,
    })

    expect(completed.timers[0]?.kind).toBe('completed')
    expect(completed.timers[0]?.run?.output).toEqual({ first: 1, second: 2 })
    expect(executions).toBe(2)
  })

  it('drains unknown-length work until the deadline margin, then resumes without a batch size', async () => {
    let wallNow = 1_000
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => wallNow)

    try {
      const store = inMemoryWorkflowExecutionStore()
      const queue = ['a', 'b', 'c', 'd']
      const processed: Array<string> = []
      const workflow = createWorkflow({ id: 'queue-drain' }).handler(
        async (ctx) => {
          for (let index = 0; ; index++) {
            const item = await ctx.step(`take-${index}`, () => {
              return queue.shift() ?? null
            })
            if (item === null) return { processed }
            await ctx.step(`process-${item}`, () => {
              processed.push(item)
              wallNow += 600
            })
          }
        },
      )
      const runtime = defineWorkflowRuntime({
        store,
        workflows: {
          'queue-drain': { load: async () => workflow },
        },
      })

      const first = await runtime.startRun({
        workflowId: 'queue-drain',
        runId: 'queue-drain:1',
        input: {},
        now: 10,
        deadline: 2_500,
        minYieldRemainingMs: 500,
      })

      expect(first.kind).toBe('paused')
      expect(processed).toEqual(['a', 'b'])

      const resumed = await runtime.sweep({
        now: 11,
        deadline: 10_000,
        minYieldRemainingMs: 500,
      })

      expect(resumed.timers[0]?.kind).toBe('completed')
      expect(resumed.timers[0]?.run?.output).toEqual({
        processed: ['a', 'b', 'c', 'd'],
      })
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('does not resume a sweep-yielded run again in the same sweep', async () => {
    const store = inMemoryWorkflowExecutionStore()
    let executions = 0
    const workflow = createWorkflow({ id: 'sweep-yield' }).handler(
      async (ctx) => {
        await ctx.runtime.yield()
        const value = await ctx.step('fresh-work', () => ++executions)
        return { value }
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        'sweep-yield': {
          load: async () => {
            await Promise.resolve()
            return workflow
          },
        },
      },
    })
    await store.upsertSchedule({
      scheduleId: 'sweep-yield-now',
      workflowId: 'sweep-yield',
      schedule: { kind: 'interval', everyMs: 60_000 },
      overlapPolicy: 'skip',
      input: {},
      nextFireAt: 500,
      enabled: true,
      now: 0,
    })

    const first = await runtime.sweep({
      now: 500,
      leaseOwner: 'worker-a',
    })

    expect(first.scheduled[0]?.kind).toBe('paused')
    expect(first.timers).toEqual([])
    expect(executions).toBe(0)

    const second = await runtime.sweep({
      now: 501,
      deadline: Date.now() + 60_000,
      leaseOwner: 'worker-b',
    })

    expect(second.timers[0]?.kind).toBe('completed')
    expect(executions).toBe(1)
  })

  it('keeps sequential timers at the same timestamp independently deliverable', async () => {
    const store = inMemoryWorkflowExecutionStore()
    const workflow = createWorkflow({ id: 'same-time-timers' }).handler(
      async (ctx) => {
        await ctx.sleepUntil(700, { id: 'first' })
        await ctx.sleepUntil(700, { id: 'second' })
        return { done: true }
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        'same-time-timers': { load: async () => workflow },
      },
    })

    const started = await runtime.startRun({
      workflowId: 'same-time-timers',
      runId: 'same-time-timers:1',
      input: {},
      now: 700,
    })
    const wake = await runtime.sweep({ now: 700 })

    expect(started.kind).toBe('paused')
    expect(wake.timers.map((result) => result.kind)).toEqual([
      'paused',
      'completed',
    ])
  })

  it('stops a sweep before claiming work inside the cooperative margin', async () => {
    const store = inMemoryWorkflowExecutionStore()
    const workflow = createWorkflow({ id: 'margin-stop' }).handler(async () => {
      return { done: true }
    })
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        'margin-stop': { load: async () => workflow },
      },
    })
    await store.upsertSchedule({
      scheduleId: 'margin-stop-now',
      workflowId: 'margin-stop',
      schedule: { kind: 'interval', everyMs: 60_000 },
      overlapPolicy: 'skip',
      input: {},
      nextFireAt: 600,
      enabled: true,
      now: 0,
    })

    const result = await runtime.sweep({
      now: 600,
      deadline: Date.now() + 60_000,
      minYieldRemainingMs: 120_000,
    })

    expect(result.scheduled).toEqual([])
    expect(result.deadlineReached).toBe(true)
    expect(result.remainingMayExist).toBe(true)
    expect(
      await store.loadRun('margin-stop:margin-stop-now:600'),
    ).toBeUndefined()
  })

  it('uses the earlier of an absolute deadline and max duration', async () => {
    const store = inMemoryWorkflowExecutionStore()
    let executions = 0
    const workflow = createWorkflow({ id: 'earliest-deadline' }).handler(
      async (ctx) => {
        await ctx.step('work', () => ++executions)
        return {}
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        'earliest-deadline': { load: async () => workflow },
      },
    })

    const result = await runtime.startRun({
      workflowId: 'earliest-deadline',
      runId: 'earliest-deadline:1',
      input: {},
      now: 700,
      deadline: Date.now() + 60_000,
      maxDurationMs: 0,
      minYieldRemainingMs: 0,
    })

    expect(result.kind).toBe('paused')
    expect(executions).toBe(0)
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

  it('heartbeats the run lease during long work and stops after the drive', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    try {
      const store = inMemoryWorkflowExecutionStore()
      const heartbeat = vi.spyOn(store, 'heartbeatRunLease')
      const stepStarted = deferred<void>()
      const releaseStep = deferred<void>()
      const workflow = createWorkflow({ id: 'heartbeat' }).handler(
        async (ctx) => {
          return ctx.step('slow-step', async () => {
            stepStarted.resolve()
            await releaseStep.promise
            return { done: true }
          })
        },
      )
      const runtime = defineWorkflowRuntime({
        store,
        workflows: {
          heartbeat: { load: async () => workflow },
        },
      })

      const runPromise = runtime.startRun({
        workflowId: 'heartbeat',
        runId: 'heartbeat:1',
        input: {},
        now: 1_000,
        leaseOwner: 'worker-a',
        leaseMs: 90,
      })
      await stepStarted.promise

      await vi.advanceTimersByTimeAsync(30)
      expect(heartbeat).toHaveBeenCalledWith({
        runId: 'heartbeat:1',
        leaseOwner: 'worker-a',
        leaseMs: 90,
        now: 1_030,
      })
      expect(await store.loadRun('heartbeat:1')).toMatchObject({
        lease: { owner: 'worker-a', expiresAt: 1_120 },
      })
      expect(
        (
          await runtime.sweep({
            now: 1_119,
            leaseOwner: 'worker-b',
          })
        ).recovered,
      ).toEqual([])

      releaseStep.resolve()
      expect((await runPromise).kind).toBe('completed')
      const heartbeatCount = heartbeat.mock.calls.length

      await vi.advanceTimersByTimeAsync(90)
      expect(heartbeat).toHaveBeenCalledTimes(heartbeatCount)
      expect(await store.loadRun('heartbeat:1')).toMatchObject({
        status: 'finished',
        lease: undefined,
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers stale running executions during sweep', async () => {
    const store = inMemoryWorkflowExecutionStore()
    let firstExecutions = 0
    let secondExecutions = 0
    const published: Array<string> = []
    const workflow = createWorkflow({ id: 'recover-stale' }).handler(
      async (ctx) => {
        const first = await ctx.step('first', () => ++firstExecutions)
        const second = await ctx.step('second', () => ++secondExecutions)
        return { first, second }
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        'recover-stale': { load: async () => workflow },
      },
    })

    await store.createRun({
      runId: 'recover-stale:1',
      workflowId: 'recover-stale',
      input: {},
      now: 0,
    })
    await store.saveRunState({
      state: {
        runId: 'recover-stale:1',
        workflowId: 'recover-stale',
        status: 'running',
        input: {},
        createdAt: 0,
        updatedAt: 0,
      },
    })
    await store.appendEvents({
      runId: 'recover-stale:1',
      expectedNextIndex: 0,
      events: [
        {
          type: 'STEP_FINISHED',
          ts: 0,
          stepId: 'first',
          result: 41,
        },
      ],
    })
    await store.claimRun({
      runId: 'recover-stale:1',
      leaseOwner: 'dead-worker',
      leaseMs: 100,
      now: 0,
    })

    const result = await runtime.sweep({
      now: 101,
      leaseOwner: 'recovery-worker',
      publish: (_runId, event) => {
        published.push(event.type)
      },
    })

    expect(result.recovered).toHaveLength(1)
    expect(result.recovered[0]).toMatchObject({
      kind: 'completed',
      runId: 'recover-stale:1',
      run: {
        status: 'finished',
        lease: undefined,
        output: { first: 41, second: 1 },
      },
    })
    expect(result.summary.recovered.completed).toBe(1)
    expect(firstExecutions).toBe(0)
    expect(secondExecutions).toBe(1)
    expect(published).toContain('RUN_STARTED')
    expect(published).toContain('RUN_FINISHED')

    const duplicateSweep = await runtime.sweep({
      now: 102,
      leaseOwner: 'other-worker',
    })
    expect(duplicateSweep.recovered).toEqual([])
  })

  it('starts stale executions that crashed before core state was created', async () => {
    const store = inMemoryWorkflowExecutionStore()
    let executions = 0
    const workflow = createWorkflow({ id: 'recover-uninitialized' }).handler(
      async (ctx) => {
        const value = await ctx.step('work', () => ++executions)
        return { value }
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        'recover-uninitialized': { load: async () => workflow },
      },
    })

    await store.createRun({
      runId: 'recover-uninitialized:1',
      workflowId: 'recover-uninitialized',
      input: {},
      now: 0,
    })
    await store.claimRun({
      runId: 'recover-uninitialized:1',
      leaseOwner: 'dead-worker',
      leaseMs: 100,
      now: 0,
    })

    const result = await runtime.sweep({
      now: 101,
      leaseOwner: 'recovery-worker',
    })

    expect(result.recovered[0]).toMatchObject({
      kind: 'completed',
      run: { output: { value: 1 } },
    })
    expect(executions).toBe(1)
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
