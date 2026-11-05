import { describe, expect, it, vi } from 'vitest'
import { createWorkflow } from '@tanstack/workflow-core'
import {
  defineWorkflowRuntime,
  every,
  inMemoryWorkflowExecutionStore,
} from '@tanstack/workflow-runtime'
import {
  createRailwayWorkflowCronCommand,
  materializeWorkflowSchedules,
} from '../src'
import type { WorkflowScheduleSpec } from '@tanstack/workflow-runtime'

describe('Railway workflow cron command adapter', () => {
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

  it('returns a Railway cron command summary', async () => {
    const runtime = createRuntime()
    const command = createRailwayWorkflowCronCommand({
      runtime,
      now: () => 900_000,
      leaseOwner: 'railway:test',
    })

    const result = await command()

    expect(result.ok).toBe(true)
    expect(result.now).toBe(900_000)
    expect(result.leaseOwner).toBe('railway:test')
    expect(result.materialized).toHaveLength(1)
    expect(result.summary.materialized).toBe(1)
    expect(result.summary.scheduled.completed).toBe(1)
    expect(result.summary.returnedEventCount).toBe(0)
    expect(result.sweep).toBeUndefined()
  })

  it('can include the full runtime sweep result for debugging', async () => {
    const runtime = createRuntime()
    const command = createRailwayWorkflowCronCommand({
      runtime,
      now: () => 900_000,
      includeEvents: true,
      includeSweepResult: true,
    })

    const result = await command()

    expect(result.sweep?.scheduled[0]?.kind).toBe('completed')
    expect(result.sweep?.scheduled[0]?.events.length).toBeGreaterThan(0)
  })

  it('can log the compact summary', async () => {
    const runtime = createRuntime()
    const logSummary = vi.fn()
    const command = createRailwayWorkflowCronCommand({
      runtime,
      now: () => 900_000,
      logSummary,
    })

    const result = await command()

    expect(logSummary).toHaveBeenCalledWith(result)
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
