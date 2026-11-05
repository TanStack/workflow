import { describe, expect, it } from 'vitest'
import { createWorkflow, runWorkflow } from '@tanstack/workflow-core'
import { createRunStoreAdapter, inMemoryWorkflowExecutionStore } from '../src'

describe('createRunStoreAdapter', () => {
  it('runs a workflow-core workflow through WorkflowExecutionStore storage', async () => {
    const executionStore = inMemoryWorkflowExecutionStore()
    const runStore = createRunStoreAdapter(executionStore)
    const workflow = createWorkflow({
      id: 'adapter-smoke',
    }).handler(async (ctx) => {
      const value = await ctx.step('compute', () => 42)
      return { value }
    })

    const events = await collect(
      runWorkflow({
        workflow,
        runStore,
        runId: 'adapter-run-1',
        input: {},
      }),
    )

    expect(events.find((event) => event.type === 'RUN_FINISHED')).toMatchObject(
      {
        output: { value: 42 },
      },
    )

    const timeline = await executionStore.getRunTimeline('adapter-run-1')
    expect(timeline?.events.map((event) => event.event.type)).toEqual([
      'STEP_FINISHED',
      'RUN_FINISHED',
    ])
  })

  it('pauses and resumes a signal workflow through the adapter', async () => {
    const executionStore = inMemoryWorkflowExecutionStore()
    const runStore = createRunStoreAdapter(executionStore)
    const workflow = createWorkflow({
      id: 'adapter-signal',
    }).handler(async (ctx) => {
      const payload = await ctx.waitForEvent<{ ok: boolean }>('done')
      return payload
    })

    await collect(
      runWorkflow({
        workflow,
        runStore,
        runId: 'adapter-run-2',
        input: {},
      }),
    )
    expect(await executionStore.loadRun('adapter-run-2')).toMatchObject({
      status: 'paused',
      waitingFor: { signalName: 'done' },
    })

    const events = await collect(
      runWorkflow({
        workflow,
        runStore,
        runId: 'adapter-run-2',
        signalDelivery: {
          signalId: 'signal-1',
          name: 'done',
          payload: { ok: true },
        },
      }),
    )

    expect(events.find((event) => event.type === 'RUN_FINISHED')).toMatchObject(
      {
        output: { ok: true },
      },
    )
  })
})

async function collect<T>(iterable: AsyncIterable<T>): Promise<Array<T>> {
  const values: Array<T> = []
  for await (const value of iterable) values.push(value)
  return values
}
