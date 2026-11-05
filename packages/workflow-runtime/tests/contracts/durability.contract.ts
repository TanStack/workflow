import { describe, expect, it } from 'vitest'
import { createWorkflow } from '@tanstack/workflow-core'
import { defineWorkflowRuntime } from '../../src'
import type { WorkflowEvent } from '@tanstack/workflow-core'
import type { WorkflowExecutionStore } from '../../src'

type StoreFactory = () =>
  | WorkflowExecutionStore
  | Promise<WorkflowExecutionStore>

export function runDurabilityContractTests(options: {
  name: string
  createStore: StoreFactory
}) {
  describe(`${options.name} durable execution`, () => {
    it('keeps early signals opt in and rejects unsupported adapters explicitly', async () => {
      const store = await options.createStore()
      await store.createRun({
        runId: 'early',
        workflowId: 'flow',
        input: {},
        now: 0,
      })
      expect(
        (
          await store.deliverSignal({
            runId: 'early',
            delivery: { signalId: 's', name: 'ready', payload: 1 },
            now: 0,
          })
        ).kind,
      ).toBe('not-waiting')
      expect(() =>
        defineWorkflowRuntime({
          store: { ...store, bufferSignal: undefined },
          workflows: {},
          bufferSignals: true,
        }),
      ).toThrow('inbox support')
    })

    it('buffers in acceptance order, deduplicates across waits, and retains targeted signals', async () => {
      const store = await options.createStore()
      await store.createRun({
        runId: 'inbox',
        workflowId: 'flow',
        input: {},
        now: 0,
      })
      for (const [signalId, payload, stepId] of [
        ['target', 3, 'third'],
        ['one', 1, undefined],
        ['two', 2, undefined],
      ] as const) {
        expect(
          (
            await store.bufferSignal!({
              runId: 'inbox',
              delivery: { signalId, name: 'ready', payload, stepId },
              now: 0,
            })
          ).kind,
        ).toBe('buffered')
      }
      expect(
        (
          await store.bufferSignal!({
            runId: 'inbox',
            delivery: { signalId: 'one', name: 'ready', payload: 99 },
            now: 0,
          })
        ).kind,
      ).toBe('duplicate')
      const workflow = createWorkflow({ id: 'flow' }).handler(async (ctx) => [
        await ctx.waitForEvent('ready', { id: 'first' }),
        await ctx.waitForEvent('ready', { id: 'second' }),
        await ctx.waitForEvent('ready', { id: 'third' }),
      ])
      const runtime = defineWorkflowRuntime({
        store,
        workflows: { flow: { load: async () => workflow } },
        bufferSignals: true,
      })
      expect((await runtime.sweep()).recovered[0]?.run?.output).toEqual([
        1, 2, 3,
      ])
      expect(
        (
          await store.bufferSignal!({
            runId: 'inbox',
            delivery: { signalId: 'one', name: 'ready', payload: 99 },
            now: 0,
          })
        ).kind,
      ).toBe('duplicate')
      expect(
        (
          await store.bufferSignal!({
            runId: 'inbox',
            delivery: { signalId: 'late', name: 'ready', payload: 99 },
            now: 0,
          })
        ).kind,
      ).toBe('not-waiting')
      await store.deleteRun('inbox', 'finished')
      await store.createRun({
        runId: 'inbox',
        workflowId: 'flow',
        input: {},
        now: 0,
      })
      expect(
        (
          await store.bufferSignal!({
            runId: 'inbox',
            delivery: { signalId: 'one', name: 'ready', payload: 1 },
            now: 0,
          })
        ).kind,
      ).toBe('buffered')
    })

    it('atomically consumes a signal when workers race at the same log index', async () => {
      const store = await options.createStore()
      await store.createRun({
        runId: 'race',
        workflowId: 'flow',
        input: {},
        now: 0,
      })
      await store.bufferSignal!({
        runId: 'race',
        delivery: { signalId: 's', name: 'ready', payload: { amount: 10 } },
        now: 0,
      })
      await Promise.allSettled(
        ['a', 'b'].map((stepId) =>
          store.consumeBufferedSignal!({
            runId: 'race',
            name: 'ready',
            stepId,
            expectedNextIndex: 0,
            now: 0,
          }),
        ),
      )
      const events = await store.readEvents({ runId: 'race' })
      expect(events).toHaveLength(1)
      expect(events[0]?.event).toMatchObject({
        type: 'SIGNAL_RESOLVED',
        signalId: 's',
        payload: { amount: 10 },
      })
      expect(
        await store.consumeBufferedSignal!({
          runId: 'race',
          name: 'ready',
          stepId: 'next',
          expectedNextIndex: 1,
          now: 1,
        }),
      ).toBeUndefined()
    })

    it('recovers a signal accepted after the wait checked the inbox but before pause persisted', async () => {
      const store = await options.createStore()
      let buffered = false
      const racingStore: WorkflowExecutionStore = {
        ...store,
        async saveRunState(args) {
          if (args.state.status === 'paused' && !buffered) {
            buffered = true
            await store.bufferSignal!({
              runId: args.state.runId,
              delivery: { signalId: 's', name: 'ready', payload: 42 },
              now: Date.now(),
            })
          }
          await store.saveRunState(args)
        },
      }
      const workflow = createWorkflow({ id: 'flow' }).handler((ctx) =>
        ctx.waitForEvent('ready'),
      )
      const config = {
        workflows: { flow: { load: async () => workflow } },
        bufferSignals: true,
      }
      expect(
        (
          await defineWorkflowRuntime({
            ...config,
            store: racingStore,
          }).startRun({ workflowId: 'flow', runId: 'pause-race', input: {} })
        ).kind,
      ).toBe('paused')
      expect(
        (await defineWorkflowRuntime({ ...config, store }).sweep()).recovered[0]
          ?.run?.output,
      ).toBe(42)
    })

    it('persists retry attempts and deadlines across new runtime instances', async () => {
      const store = await options.createStore()
      const calls: number[] = []
      const workflow = createWorkflow({ id: 'flow' }).handler((ctx) =>
        ctx.step(
          'flaky',
          ({ attempt }) => {
            calls.push(attempt)
            if (attempt < 3) throw new Error(`failure ${attempt}`)
            return 42
          },
          {
            retry: {
              durable: true,
              maxAttempts: 3,
              baseMs: 100,
              backoff: 'fixed',
            },
          },
        ),
      )
      const config = {
        store,
        workflows: { flow: { load: async () => workflow } },
      }
      expect(
        (
          await defineWorkflowRuntime(config).startRun({
            workflowId: 'flow',
            runId: 'retry',
            input: {},
          })
        ).kind,
      ).toBe('paused')
      const history = await store.readEvents({ runId: 'retry' })
      const retry = history.find(
        ({ event }) => event.type === 'STEP_RETRY_SCHEDULED',
      )!.event
      expect(retry).toMatchObject({
        attempt: 1,
        error: { message: 'failure 1' },
      })
      expect(
        (await defineWorkflowRuntime(config).sweep({ now: 0 })).timers,
      ).toEqual([])
      expect(calls).toEqual([1])
      for (let i = 0; i < 2; i++)
        await defineWorkflowRuntime(config).sweep({
          now: Date.now() + 10_000,
          maxTimers: 1,
        })
      expect(calls).toEqual([1, 2, 3])
      expect((await store.loadRun('retry'))?.output).toBe(42)
      await defineWorkflowRuntime(config).sweep({ now: Date.now() + 20_000 })
      expect(calls).toEqual([1, 2, 3])
    })

    for (const boundary of ['STEP_RETRY_SCHEDULED', 'paused'] as const) {
      it(`recovers a crash after ${boundary} without losing the next retry`, async () => {
        const store = await options.createStore()
        const calls: number[] = []
        const workflow = createWorkflow({ id: 'flow' }).handler((ctx) =>
          ctx.step(
            'flaky',
            ({ attempt }) => {
              calls.push(attempt)
              if (attempt === 1) throw new Error('retry me')
              return 7
            },
            { retry: { durable: true, maxAttempts: 2, baseMs: 1 } },
          ),
        )
        const workflows = { flow: { load: async () => workflow } }
        await defineWorkflowRuntime({
          store: crashAfter(store, boundary),
          workflows,
        })
          .startRun({
            workflowId: 'flow',
            runId: 'crash',
            input: {},
            leaseMs: 100,
          })
          .catch(() => {})
        for (let i = 0; i < 3; i++)
          await defineWorkflowRuntime({ store, workflows }).sweep({
            now: Date.now() + 10_000,
          })
        expect(calls).toEqual([1, 2])
        expect((await store.loadRun('crash'))?.output).toBe(7)
      })
    }

    it('replays consumed payloads after a crash before the handler receives them', async () => {
      const store = await options.createStore()
      await store.createRun({
        runId: 'consume-crash',
        workflowId: 'flow',
        input: {},
        now: 0,
      })
      await store.bufferSignal!({
        runId: 'consume-crash',
        delivery: { signalId: 's', name: 'ready', payload: 21 },
        now: 0,
      })
      const workflow = createWorkflow({ id: 'flow' }).handler((ctx) =>
        ctx.waitForEvent('ready'),
      )
      const workflows = { flow: { load: async () => workflow } }
      await defineWorkflowRuntime({
        store: crashAfter(store, 'consumed'),
        workflows,
      })
        .startRun({ workflowId: 'flow', runId: 'consume-crash', input: {} })
        .catch(() => {})
      await defineWorkflowRuntime({ store, workflows }).sweep({
        now: Date.now() + 100_000,
      })
      expect((await store.loadRun('consume-crash'))?.output).toBe(21)
      expect(
        (await store.readEvents({ runId: 'consume-crash' })).filter(
          ({ event }) => event.type === 'SIGNAL_RESOLVED',
        ),
      ).toHaveLength(1)
    })

    it('runs compensation in reverse order and resumes its retries after a crash', async () => {
      const store = await options.createStore()
      const calls: string[] = []
      const workflow = createWorkflow({ id: 'flow' }).handler(async (ctx) => {
        await ctx.compensate('first', () => {
          calls.push('undo first')
        })
        await ctx.step('first', () => {
          calls.push('first')
        })
        await ctx.compensate(
          'second',
          ({ attempt }) => {
            calls.push(`undo second ${attempt}`)
            if (attempt === 1) throw new Error('undo unavailable')
          },
          { retry: { maxAttempts: 2, baseMs: 1 } },
        )
        await ctx.step('second', () => {
          calls.push('second')
        })
        await ctx.step('fail', () => {
          throw new Error('original failure')
        })
      })
      const workflows = { flow: { load: async () => workflow } }
      await defineWorkflowRuntime({
        store: crashAfter(store, 'STEP_RETRY_SCHEDULED'),
        workflows,
      })
        .startRun({ workflowId: 'flow', runId: 'undo', input: {} })
        .catch(() => {})
      for (let i = 0; i < 3; i++)
        await defineWorkflowRuntime({ store, workflows }).sweep({
          now: Date.now() + 100_000,
        })
      expect(calls).toEqual([
        'first',
        'second',
        'undo second 1',
        'undo second 2',
        'undo first',
      ])
      expect(await store.loadRun('undo')).toMatchObject({
        status: 'errored',
        error: { message: 'original failure' },
      })
    })

    it('does not repeat completed compensations after a crash', async () => {
      const store = await options.createStore()
      const calls: string[] = []
      const workflow = createWorkflow({ id: 'flow' }).handler(async (ctx) => {
        await ctx.compensate('first', () => {
          calls.push('first')
        })
        await ctx.compensate('second', () => {
          calls.push('second')
        })
        throw new Error('fail')
      })
      const workflows = { flow: { load: async () => workflow } }
      await defineWorkflowRuntime({
        store: crashAfter(store, 'compensated'),
        workflows,
      })
        .startRun({ workflowId: 'flow', runId: 'undo-complete', input: {} })
        .catch(() => {})
      await defineWorkflowRuntime({ store, workflows }).sweep({
        now: Date.now() + 100_000,
      })
      expect(calls).toEqual(['second', 'first'])
      expect((await store.loadRun('undo-complete'))?.status).toBe('errored')
    })

    it('recovers a timer resolution committed before the worker died', async () => {
      const store = await options.createStore()
      const calls: number[] = []
      const workflow = createWorkflow({ id: 'flow' }).handler((ctx) =>
        ctx.step(
          'retry',
          ({ attempt }) => {
            calls.push(attempt)
            if (attempt === 1) throw new Error('retry')
            return 1
          },
          { retry: { durable: true, maxAttempts: 2, baseMs: 1 } },
        ),
      )
      const workflows = { flow: { load: async () => workflow } }
      await defineWorkflowRuntime({ store, workflows }).startRun({
        workflowId: 'flow',
        runId: 'timer-crash',
        input: {},
      })
      await defineWorkflowRuntime({
        store: crashAfter(store, 'SIGNAL_RESOLVED'),
        workflows,
      })
        .sweep({ now: Date.now() + 100_000 })
        .catch(() => {})
      await defineWorkflowRuntime({ store, workflows }).sweep({
        now: Date.now() + 200_000,
      })
      expect(calls).toEqual([1, 2])
      expect((await store.loadRun('timer-crash'))?.status).toBe('finished')
      expect(
        await store.claimDueTimers({
          now: Date.now() + 300_000,
          leaseMs: 100,
          leaseOwner: 'check',
          limit: 10,
        }),
      ).toEqual([])
    })

    it('rejects a late step result from a worker whose lease was replaced', async () => {
      const store = await options.createStore()
      let release!: () => void
      let started!: () => void
      const startedPromise = new Promise<void>((resolve) => {
        started = resolve
      })
      const blocked = new Promise<void>((resolve) => {
        release = resolve
      })
      let compensated = false
      const workflow = createWorkflow({ id: 'flow' }).handler(async (ctx) => {
        await ctx.compensate('undo', () => {
          compensated = true
        })
        return ctx.step('blocked', async () => {
          started()
          await blocked
          return 'old result'
        })
      })
      const running = defineWorkflowRuntime({
        store,
        workflows: { flow: { load: async () => workflow } },
      }).startRun({ workflowId: 'flow', runId: 'late-worker', input: {} })
      await startedPromise
      const now = Date.now() + 100_000
      await store.claimRun({
        runId: 'late-worker',
        leaseOwner: 'winner',
        leaseMs: 100_000,
        now,
      })
      const state = (await store.loadRunState('late-worker'))!
      await store.saveRunState({
        state: { ...state, status: 'finished', output: 'winner' },
        leaseOwner: 'winner',
      })
      const rejected = expect(running).rejects.toThrow()
      release()
      await rejected
      expect(compensated).toBe(false)
      expect((await store.loadRun('late-worker'))?.output).toBe('winner')
      expect(
        (await store.readEvents({ runId: 'late-worker' })).some(
          ({ event }) =>
            event.type === 'STEP_FINISHED' && event.result === 'old result',
        ),
      ).toBe(false)
    })

    it('repeats an interrupted attempt with the same external idempotency key', async () => {
      const store = await options.createStore()
      const applied = new Set<string>()
      const attempts: number[] = []
      const workflow = createWorkflow({ id: 'flow' }).handler((ctx) =>
        ctx.step(
          'effect',
          ({ id, attempt }) => {
            applied.add(id)
            attempts.push(attempt)
            return 'applied'
          },
          { retry: { durable: true, maxAttempts: 2 } },
        ),
      )
      const workflows = { flow: { load: async () => workflow } }
      await defineWorkflowRuntime({
        store: crashAfter(store, 'effect-before-checkpoint'),
        workflows,
      })
        .startRun({ workflowId: 'flow', runId: 'ambiguous-effect', input: {} })
        .catch(() => {})
      await defineWorkflowRuntime({ store, workflows }).sweep({
        now: Date.now() + 100_000,
      })
      expect(attempts).toEqual([1, 1])
      expect([...applied]).toEqual(['ambiguous-effect:effect'])
      expect((await store.loadRun('ambiguous-effect'))?.output).toBe('applied')
    })

    it('stops at exhausted compensation and records both failures', async () => {
      const store = await options.createStore()
      const calls: string[] = []
      const workflow = createWorkflow({ id: 'flow' }).handler(async (ctx) => {
        await ctx.compensate('first', () => {
          calls.push('first')
        })
        await ctx.compensate(
          'second',
          () => {
            calls.push('second')
            throw new Error('undo failed')
          },
          { retry: { maxAttempts: 2, baseMs: 1 } },
        )
        throw new Error('original failure')
      })
      const config = {
        store,
        workflows: { flow: { load: async () => workflow } },
      }
      await defineWorkflowRuntime(config).startRun({
        workflowId: 'flow',
        runId: 'exhausted',
        input: {},
      })
      await defineWorkflowRuntime(config).sweep({ now: Date.now() + 10_000 })
      expect(calls).toEqual(['second', 'second'])
      expect((await store.loadRun('exhausted'))?.error?.message).toContain(
        'undo failed',
      )
      expect((await store.loadRun('exhausted'))?.error?.message).toContain(
        'original failure',
      )
    })

    it('fences stale state, event, and inbox writes after another worker claims the run', async () => {
      const store = await options.createStore()
      const now = Date.now()
      await store.createRun({
        runId: 'fence',
        workflowId: 'flow',
        input: {},
        now,
      })
      await store.saveRunState({
        state: {
          runId: 'fence',
          workflowId: 'flow',
          input: {},
          status: 'running',
          createdAt: now,
          updatedAt: now,
        },
      })
      await store.bufferSignal!({
        runId: 'fence',
        delivery: { signalId: 's', name: 'ready', payload: 1 },
        now,
      })
      await store.claimRun({
        runId: 'fence',
        leaseOwner: 'old',
        leaseMs: 10,
        now: now - 100,
      })
      await store.claimRun({
        runId: 'fence',
        leaseOwner: 'new',
        leaseMs: 60_000,
        now,
      })
      await expect(
        store.saveRunState({
          leaseOwner: 'old',
          state: {
            runId: 'fence',
            workflowId: 'flow',
            input: {},
            status: 'finished',
            output: 'stale',
            createdAt: now,
            updatedAt: now,
          },
        }),
      ).rejects.toThrow()
      await expect(
        store.appendEvents({
          leaseOwner: 'old',
          runId: 'fence',
          expectedNextIndex: 0,
          events: [{ type: 'CUSTOM', ts: now, name: 'stale', value: {} }],
        }),
      ).rejects.toThrow()
      await expect(
        store.consumeBufferedSignal!({
          leaseOwner: 'old',
          runId: 'fence',
          expectedNextIndex: 0,
          stepId: 'wait',
          name: 'ready',
          now,
        }),
      ).rejects.toThrow()
      expect((await store.loadRun('fence'))?.status).toBe('running')
      expect(await store.readEvents({ runId: 'fence' })).toHaveLength(0)
      expect(
        await store.consumeBufferedSignal!({
          leaseOwner: 'new',
          runId: 'fence',
          expectedNextIndex: 0,
          stepId: 'wait',
          name: 'ready',
          now,
        }),
      ).toMatchObject({ payload: 1 })
    })
  })
}

function crashAfter(
  store: WorkflowExecutionStore,
  boundary:
    | WorkflowEvent['type']
    | 'paused'
    | 'consumed'
    | 'compensated'
    | 'effect-before-checkpoint',
): WorkflowExecutionStore {
  let crashed = false
  const check = () => {
    if (crashed) throw new Error('simulated process death')
  }
  const crash = () => {
    crashed = true
    check()
  }
  return {
    ...store,
    async appendEvents(args) {
      check()
      if (
        boundary === 'effect-before-checkpoint' &&
        args.events.some((event) => event.type === 'STEP_FINISHED')
      )
        crash()
      const result = await store.appendEvents(args)
      if (
        args.events.some(
          (event) =>
            event.type === boundary ||
            (boundary === 'compensated' &&
              event.type === 'STEP_FINISHED' &&
              event.stepId.startsWith('__compensation:')),
        )
      )
        crash()
      return result
    },
    async saveRunState(args) {
      check()
      await store.saveRunState(args)
      if (boundary === 'paused' && args.state.status === 'paused') crash()
    },
    async consumeBufferedSignal(args) {
      check()
      const result = await store.consumeBufferedSignal!(args)
      if (result && boundary === 'consumed') crash()
      return result
    },
    async completeTimer(args) {
      check()
      await store.completeTimer!(args)
    },
    async scheduleTimer(args) {
      check()
      await store.scheduleTimer(args)
    },
    async heartbeatRunLease(args) {
      check()
      await store.heartbeatRunLease(args)
    },
    async releaseRunLease(args) {
      check()
      await store.releaseRunLease(args)
    },
  }
}
