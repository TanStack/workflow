import { describe, expect, it } from 'vitest'
import { LogConflictError, createWorkflow } from '@tanstack/workflow-core'
import { createRunStoreAdapter, defineWorkflowRuntime } from '../../src'
import type { WorkflowExecutionStore } from '../../src'

interface WorkflowExecutionStoreContractOptions {
  name: string
  createStore: () => WorkflowExecutionStore | Promise<WorkflowExecutionStore>
}

export function runWorkflowExecutionStoreContractTests(
  options: WorkflowExecutionStoreContractOptions,
) {
  describe(`${options.name} WorkflowExecutionStore contract`, () => {
    it('creates runs idempotently for deterministic run IDs', async () => {
      const store = await options.createStore()

      const first = await store.createRun({
        runId: 'run-1',
        workflowId: 'intent-process',
        input: { a: 1 },
        now: 100,
      })
      const second = await store.createRun({
        runId: 'run-1',
        workflowId: 'intent-process',
        input: { a: 2 },
        now: 200,
      })

      expect(first.kind).toBe('created')
      expect(second.kind).toBe('existing')
      expect(second.run.input).toEqual({ a: 1 })
    })

    it('enforces CAS append semantics and ordered replay', async () => {
      const store = await options.createStore()
      await store.appendEvents({
        runId: 'run-1',
        expectedNextIndex: 0,
        events: [
          { type: 'CUSTOM', ts: 1, name: 'a', value: {} },
          { type: 'CUSTOM', ts: 2, name: 'b', value: {} },
        ],
      })

      await expect(
        store.appendEvents({
          runId: 'run-1',
          expectedNextIndex: 1,
          events: [{ type: 'CUSTOM', ts: 3, name: 'c', value: {} }],
        }),
      ).rejects.toBeInstanceOf(LogConflictError)

      const allEvents = await store.readEvents({ runId: 'run-1' })
      const fromSecond = await store.readEvents({
        runId: 'run-1',
        fromIndex: 1,
      })

      expect(allEvents.map((event) => event.eventIndex)).toEqual([0, 1])
      expect(allEvents.map((event) => event.eventType)).toEqual([
        'CUSTOM',
        'CUSTOM',
      ])
      expect(fromSecond).toHaveLength(1)
      expect(fromSecond[0]?.event).toMatchObject({ name: 'b' })
    })

    it('claims, blocks, and reclaims run leases', async () => {
      const store = await options.createStore()
      await store.createRun({
        runId: 'run-1',
        workflowId: 'intent-process',
        input: {},
        now: 0,
      })

      const first = await store.claimRun({
        runId: 'run-1',
        leaseOwner: 'worker-a',
        leaseMs: 100,
        now: 10,
      })
      const blocked = await store.claimRun({
        runId: 'run-1',
        leaseOwner: 'worker-b',
        leaseMs: 100,
        now: 20,
      })
      const reclaimed = await store.claimRun({
        runId: 'run-1',
        leaseOwner: 'worker-b',
        leaseMs: 100,
        now: 111,
      })

      expect(first.kind).toBe('claimed')
      expect(blocked.kind).toBe('not-claimable')
      expect(reclaimed).toMatchObject({
        kind: 'claimed',
        run: { lease: { owner: 'worker-b', expiresAt: 211 } },
      })
    })

    it('claims stale running leases', async () => {
      const store = await options.createStore()
      await store.createRun({
        runId: 'run-1',
        workflowId: 'intent-process',
        input: {},
        now: 0,
      })
      await store.claimRun({
        runId: 'run-1',
        leaseOwner: 'worker-a',
        leaseMs: 100,
        now: 0,
      })

      const early = await store.claimStaleRuns({
        now: 99,
        limit: 10,
        leaseOwner: 'worker-b',
        leaseMs: 100,
      })
      const stale = await store.claimStaleRuns({
        now: 101,
        limit: 10,
        leaseOwner: 'worker-b',
        leaseMs: 100,
      })

      expect(early).toEqual([])
      expect(stale).toHaveLength(1)
      expect(stale[0]).toMatchObject({
        run: { runId: 'run-1' },
        lease: { owner: 'worker-b', expiresAt: 201 },
      })
    })

    it('claims due timers once per active lease window', async () => {
      const store = await options.createStore()
      await store.createRun({
        runId: 'run-1',
        workflowId: 'timer-workflow',
        input: {},
        now: 0,
      })
      await store.scheduleTimer({
        runId: 'run-1',
        workflowId: 'timer-workflow',
        wakeAt: 100,
        signalId: 'timer-1',
        now: 1,
      })

      expect(
        await store.claimDueTimers({
          now: 99,
          limit: 10,
          leaseOwner: 'worker-a',
          leaseMs: 50,
        }),
      ).toEqual([])

      const first = await store.claimDueTimers({
        now: 100,
        limit: 10,
        leaseOwner: 'worker-a',
        leaseMs: 50,
      })
      const blocked = await store.claimDueTimers({
        now: 110,
        limit: 10,
        leaseOwner: 'worker-b',
        leaseMs: 50,
      })
      const reclaimed = await store.claimDueTimers({
        now: 151,
        limit: 10,
        leaseOwner: 'worker-b',
        leaseMs: 50,
      })

      expect(first).toHaveLength(1)
      expect(first[0]).toMatchObject({
        runId: 'run-1',
        workflowId: 'timer-workflow',
        wakeAt: 100,
        signalId: 'timer-1',
      })
      expect(blocked).toEqual([])
      expect(reclaimed).toHaveLength(1)
    })

    it('delivers signals idempotently and marks the run ready', async () => {
      const store = await options.createStore()
      await store.saveRunState({
        state: {
          runId: 'run-1',
          workflowId: 'signal-workflow',
          status: 'paused',
          input: {},
          waitingFor: { signalName: 'approval-received' },
          createdAt: 0,
          updatedAt: 0,
        },
      })

      const delivered = await store.deliverSignal({
        runId: 'run-1',
        delivery: {
          signalId: 'signal-1',
          name: 'approval-received',
          payload: { approved: true },
        },
        now: 100,
      })
      const duplicate = await store.deliverSignal({
        runId: 'run-1',
        delivery: {
          signalId: 'signal-1',
          name: 'approval-received',
          payload: { approved: true },
        },
        now: 101,
      })

      expect(delivered).toMatchObject({
        kind: 'delivered',
        run: { status: 'queued', waitingFor: undefined },
      })
      expect(duplicate.kind).toBe('duplicate')
    })

    it('rejects signals for runs waiting on a different signal', async () => {
      const store = await options.createStore()
      await store.saveRunState({
        state: {
          runId: 'run-1',
          workflowId: 'signal-workflow',
          status: 'paused',
          input: {},
          waitingFor: { signalName: 'expected' },
          createdAt: 0,
          updatedAt: 0,
        },
      })

      const delivered = await store.deliverSignal({
        runId: 'run-1',
        delivery: {
          signalId: 'signal-1',
          name: 'wrong',
          payload: {},
        },
        now: 100,
      })

      expect(delivered.kind).toBe('not-waiting')
    })

    it('delivers approvals idempotently and marks the run ready', async () => {
      const store = await options.createStore()
      await store.saveRunState({
        state: {
          runId: 'run-1',
          workflowId: 'approval-workflow',
          status: 'paused',
          input: {},
          pendingApproval: {
            approvalId: 'approval-1',
            title: 'Approve?',
          },
          createdAt: 0,
          updatedAt: 0,
        },
      })

      const delivered = await store.deliverApproval({
        runId: 'run-1',
        approval: {
          approvalId: 'approval-1',
          approved: true,
        },
        now: 100,
      })
      const duplicate = await store.deliverApproval({
        runId: 'run-1',
        approval: {
          approvalId: 'approval-1',
          approved: true,
        },
        now: 101,
      })

      expect(delivered).toMatchObject({
        kind: 'delivered',
        run: { status: 'queued', pendingApproval: undefined },
      })
      expect(duplicate.kind).toBe('duplicate')
    })

    it('claims due schedule buckets deterministically', async () => {
      const store = await options.createStore()
      await store.upsertSchedule({
        scheduleId: 'intent-process',
        workflowId: 'intent-process',
        schedule: { kind: 'interval', everyMs: 15 * 60 * 1000 },
        overlapPolicy: 'skip',
        input: { triggeredAt: 900_000 },
        nextFireAt: 900_000,
        enabled: true,
        now: 0,
      })

      const buckets = await store.claimDueScheduleBuckets({
        now: 900_000,
        limit: 10,
        leaseOwner: 'worker-a',
        leaseMs: 30_000,
      })
      const blocked = await store.claimDueScheduleBuckets({
        now: 900_000,
        limit: 10,
        leaseOwner: 'worker-b',
        leaseMs: 30_000,
      })

      expect(buckets).toHaveLength(1)
      expect(buckets[0]).toMatchObject({
        scheduleId: 'intent-process',
        bucketId: '900000',
        workflowId: 'intent-process',
        runId: 'intent-process:intent-process:900000',
        fireAt: 900_000,
        input: { triggeredAt: 900_000 },
        overlapPolicy: 'skip',
      })
      expect(blocked).toEqual([])
    })

    it('does not reclaim a schedule bucket after it starts', async () => {
      const store = await options.createStore()
      await store.upsertSchedule({
        scheduleId: 'intent-process',
        workflowId: 'intent-process',
        schedule: { kind: 'interval', everyMs: 15 * 60 * 1000 },
        overlapPolicy: 'skip',
        input: {},
        nextFireAt: 900_000,
        enabled: true,
        now: 0,
      })

      const buckets = await store.claimDueScheduleBuckets({
        now: 900_000,
        limit: 10,
        leaseOwner: 'worker-a',
        leaseMs: 30_000,
      })
      await store.markScheduleBucketStarted({
        scheduleId: 'intent-process',
        bucketId: '900000',
        runId: buckets[0]!.runId,
        now: 900_000,
      })
      const later = await store.claimDueScheduleBuckets({
        now: 930_001,
        limit: 10,
        leaseOwner: 'worker-b',
        leaseMs: 30_000,
      })

      expect(later).toEqual([])
    })

    it('lists runs by workflow and status', async () => {
      const store = await options.createStore()
      await store.saveRunState({
        state: {
          runId: 'run-a',
          workflowId: 'intent-process',
          status: 'finished',
          input: {},
          createdAt: 0,
          updatedAt: 10,
        },
      })
      await store.saveRunState({
        state: {
          runId: 'run-b',
          workflowId: 'intent-discover',
          status: 'paused',
          input: {},
          createdAt: 0,
          updatedAt: 20,
        },
      })

      const runs = await store.listRuns({
        workflowId: 'intent-process',
        status: 'finished',
        limit: 10,
      })

      expect(runs.map((run) => run.runId)).toEqual(['run-a'])
    })

    it('exposes run timelines with stored events', async () => {
      const store = await options.createStore()
      await store.saveRunState({
        state: {
          runId: 'run-1',
          workflowId: 'timeline-workflow',
          status: 'running',
          input: {},
          createdAt: 0,
          updatedAt: 0,
        },
      })
      await store.appendEvents({
        runId: 'run-1',
        expectedNextIndex: 0,
        events: [{ type: 'CUSTOM', ts: 1, name: 'timeline', value: {} }],
      })

      const timeline = await store.getRunTimeline('run-1')

      expect(timeline?.run.runId).toBe('run-1')
      expect(timeline?.events.map((event) => event.eventType)).toEqual([
        'CUSTOM',
      ])
    })

    it('supports the core RunStore adapter', async () => {
      const store = await options.createStore()
      const runStore = createRunStoreAdapter(store)
      await runStore.setRunState('run-1', {
        runId: 'run-1',
        workflowId: 'adapter-workflow',
        status: 'running',
        input: {},
        createdAt: 0,
        updatedAt: 0,
      })
      await runStore.appendEvent('run-1', 0, {
        type: 'CUSTOM',
        ts: 1,
        name: 'adapter',
        value: {},
      })

      await expect(
        runStore.appendEvent('run-1', 0, {
          type: 'CUSTOM',
          ts: 2,
          name: 'conflict',
          value: {},
        }),
      ).rejects.toBeInstanceOf(LogConflictError)

      expect(await runStore.getRunState('run-1')).toMatchObject({
        runId: 'run-1',
      })
      expect(await runStore.getEvents('run-1')).toMatchObject([
        { type: 'CUSTOM', name: 'adapter' },
      ])
    })

    it('drives workflow runtime start, signal, timer, and schedule paths', async () => {
      const store = await options.createStore()
      const signalWorkflow = createWorkflow({ id: 'signal' }).handler(
        async (ctx) => {
          return ctx.waitForEvent<{ ok: boolean }>('done')
        },
      )
      const timerWorkflow = createWorkflow({ id: 'timer' }).handler(
        async (ctx) => {
          await ctx.sleepUntil(100)
          return { awoke: true }
        },
      )
      const scheduledWorkflow = createWorkflow({ id: 'scheduled' }).handler(
        async (ctx) => {
          await Promise.resolve()
          return { input: ctx.input }
        },
      )
      const runtime = defineWorkflowRuntime({
        store,
        workflows: {
          signal: {
            load: async () => {
              await Promise.resolve()
              return signalWorkflow
            },
          },
          timer: {
            load: async () => {
              await Promise.resolve()
              return timerWorkflow
            },
          },
          scheduled: {
            load: async () => {
              await Promise.resolve()
              return scheduledWorkflow
            },
          },
        },
      })

      const signalStart = await runtime.startRun({
        workflowId: 'signal',
        runId: 'signal:1',
        input: {},
        now: 0,
      })
      const signalResume = await runtime.deliverSignal({
        runId: 'signal:1',
        signalId: 'signal-1',
        name: 'done',
        payload: { ok: true },
        now: 10,
      })
      const timerStart = await runtime.startRun({
        workflowId: 'timer',
        runId: 'timer:1',
        input: {},
        now: 0,
      })
      const timerSweep = await runtime.sweep({ now: 100 })

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
      const scheduleSweep = await runtime.sweep({ now: 900_000 })

      expect(signalStart.kind).toBe('paused')
      expect(signalResume.kind).toBe('completed')
      expect(timerStart.kind).toBe('paused')
      expect(timerSweep.timers[0]?.kind).toBe('completed')
      expect(scheduleSweep.scheduled[0]).toMatchObject({
        kind: 'completed',
        runId: 'scheduled:scheduled-every-15:900000',
      })
    })
  })
}
