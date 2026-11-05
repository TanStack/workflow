import { describe, expect, it } from 'vitest'
import { createWorkflow } from '@tanstack/workflow-core'
import {
  defineWorkflowRuntime,
  every,
  inMemoryWorkflowExecutionStore,
} from '@tanstack/workflow-runtime'
import {
  createCloudflareWorkflowScheduledHandler,
  materializeWorkflowSchedules,
} from '../src'
import type { WorkflowScheduleSpec } from '@tanstack/workflow-runtime'

describe('Cloudflare workflow scheduled adapter', () => {
  it('materializes interval schedules and lets the runtime sweep due work', async () => {
    const runtime = createRuntime()

    const materialized = await materializeWorkflowSchedules(runtime, {
      now: 900_000,
    })
    const sweep = await runtime.sweep({
      now: 900_000,
      leaseOwner: 'test',
    })

    expect(materialized).toMatchObject([
      {
        kind: 'materialized',
        workflowId: 'intent-process',
        scheduleId: 'intent-process-every-15m',
        fireAt: 900_000,
      },
    ])
    expect(sweep.scheduled[0]).toMatchObject({
      kind: 'completed',
      runId: 'intent-process:intent-process-every-15m:900000',
    })
  })

  it('returns a Cloudflare scheduled handler summary', async () => {
    const runtime = createRuntime()
    const handler = createCloudflareWorkflowScheduledHandler({
      runtime,
      leaseOwner: 'cloudflare:test',
    })

    const result = await handler(
      { scheduledTime: 900_000, cron: '*/15 * * * *' },
      {},
      {},
    )

    expect(result.ok).toBe(true)
    expect(result.now).toBe(900_000)
    expect(result.leaseOwner).toBe('cloudflare:test')
    expect(result.materialized).toHaveLength(1)
    expect(result.summary.materialized).toBe(1)
    expect(result.summary.scheduled.completed).toBe(1)
    expect(result.summary.returnedEventCount).toBe(0)
    expect(result.sweep).toBeUndefined()
  })

  it('can resolve the runtime from Cloudflare env', async () => {
    const runtime = createRuntime()
    const handler = createCloudflareWorkflowScheduledHandler({
      runtime: ({ env }: { env: { runtime: typeof runtime } }) => env.runtime,
      leaseOwner: ({ controller }) => `cf:${controller.cron}`,
    })

    const result = await handler(
      { scheduledTime: 900_000, cron: '*/15 * * * *' },
      { runtime },
      {},
    )

    expect(result.leaseOwner).toBe('cf:*/15 * * * *')
    expect(result.summary.scheduled.completed).toBe(1)
  })

  it('can include the full runtime sweep result for debugging', async () => {
    const runtime = createRuntime()
    const handler = createCloudflareWorkflowScheduledHandler({
      runtime,
      includeEvents: true,
      includeSweepResult: true,
    })

    const result = await handler(
      { scheduledTime: 900_000, cron: '*/15 * * * *' },
      {},
      {},
    )

    expect(result.sweep?.scheduled[0]?.kind).toBe('completed')
    expect(result.sweep?.scheduled[0]?.events.length).toBeGreaterThan(0)
  })
})

function createRuntime(
  options: {
    schedule?: WorkflowScheduleSpec
  } = {},
) {
  const store = inMemoryWorkflowExecutionStore()
  const workflow = createWorkflow({ id: 'intent-process' }).handler(
    async (ctx) => {
      await Promise.resolve()
      return { input: ctx.input }
    },
  )

  return defineWorkflowRuntime({
    store,
    workflows: {
      'intent-process': {
        load: async () => {
          await Promise.resolve()
          return workflow
        },
        schedules: [
          {
            id: 'intent-process-every-15m',
            schedule: options.schedule ?? every.minutes(15),
            overlapPolicy: 'skip',
            input: { batchSize: 50 },
          },
        ],
      },
    },
  })
}
