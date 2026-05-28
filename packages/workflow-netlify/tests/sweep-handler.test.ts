import { describe, expect, it } from 'vitest'
import { createWorkflow } from '@tanstack/workflow-core'
import {
  defineWorkflowRuntime,
  every,
  inMemoryWorkflowExecutionStore,
} from '@tanstack/workflow-runtime'
import {
  createNetlifyWorkflowSweepConfig,
  createNetlifyWorkflowSweepHandler,
  materializeWorkflowSchedules,
  netlifyWorkflowSweepConfig,
} from '../src'
import type { WorkflowScheduleSpec } from '@tanstack/workflow-runtime'

describe('Netlify workflow sweep adapter', () => {
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

  it('does not re-run the same materialized schedule bucket', async () => {
    const runtime = createRuntime()

    await materializeWorkflowSchedules(runtime, { now: 900_000 })
    const first = await runtime.sweep({ now: 900_000, leaseOwner: 'test-a' })
    await materializeWorkflowSchedules(runtime, { now: 901_000 })
    const second = await runtime.sweep({ now: 901_000, leaseOwner: 'test-b' })

    expect(first.scheduled).toHaveLength(1)
    expect(second.scheduled).toEqual([])
  })

  it('materializes a new interval bucket when the next interval is due', async () => {
    const runtime = createRuntime()

    await materializeWorkflowSchedules(runtime, { now: 900_000 })
    await runtime.sweep({ now: 900_000, leaseOwner: 'test-a' })
    await materializeWorkflowSchedules(runtime, { now: 1_800_000 })
    const second = await runtime.sweep({
      now: 1_800_000,
      leaseOwner: 'test-b',
    })

    expect(second.scheduled[0]).toMatchObject({
      kind: 'completed',
      runId: 'intent-process:intent-process-every-15m:1800000',
    })
  })

  it('supports common five-field cron schedules in UTC', async () => {
    const runtime = createRuntime({
      schedule: {
        kind: 'cron',
        expression: '*/15 * * * *',
      },
    })

    const materialized = await materializeWorkflowSchedules(runtime, {
      now: Date.UTC(2026, 4, 28, 9, 52, 30),
    })

    expect(materialized[0]).toMatchObject({
      kind: 'materialized',
      fireAt: Date.UTC(2026, 4, 28, 9, 45, 0),
    })
  })

  it('returns a Netlify-compatible scheduled function handler response', async () => {
    const runtime = createRuntime()
    const handler = createNetlifyWorkflowSweepHandler({
      runtime,
      now: () => 900_000,
      leaseOwner: 'netlify:test',
    })

    const response = await handler(new Request('https://example.com'))
    const body = (await response.json()) as {
      ok: true
      leaseOwner: string
      materialized: ReadonlyArray<unknown>
      summary: {
        materialized: number
        scheduled: { completed?: number }
        returnedEventCount: number
      }
      sweep?: unknown
    }

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.leaseOwner).toBe('netlify:test')
    expect(body.materialized).toHaveLength(1)
    expect(body.summary.materialized).toBe(1)
    expect(body.summary.scheduled.completed).toBe(1)
    expect(body.summary.returnedEventCount).toBe(0)
    expect(body.sweep).toBeUndefined()
  })

  it('can include the full runtime sweep result for debugging', async () => {
    const runtime = createRuntime()
    const handler = createNetlifyWorkflowSweepHandler({
      runtime,
      now: () => 900_000,
      leaseOwner: 'netlify:test',
      includeEvents: true,
      includeSweepResult: true,
    })

    const response = await handler(new Request('https://example.com'))
    const body = (await response.json()) as {
      sweep?: {
        scheduled: ReadonlyArray<{ kind: string; events: Array<unknown> }>
      }
    }

    expect(body.sweep?.scheduled[0]?.kind).toBe('completed')
    expect(body.sweep?.scheduled[0]?.events.length).toBeGreaterThan(0)
  })

  it('creates a default Netlify sweep config', () => {
    expect(netlifyWorkflowSweepConfig).toEqual({ schedule: '*/5 * * * *' })
    expect(createNetlifyWorkflowSweepConfig({ everyMinutes: 1 })).toEqual({
      schedule: '* * * * *',
    })
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
