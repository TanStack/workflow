import { describe, expect, it } from 'vitest'
import { createWorkflow } from '@tanstack/workflow-core'
import {
  defineWorkflowRuntime,
  every,
  inMemoryWorkflowExecutionStore,
} from '@tanstack/workflow-runtime'
import {
  createVercelWorkflowCronConfig,
  createVercelWorkflowSweepHandler,
  materializeWorkflowSchedules,
  vercelWorkflowCronConfig,
} from '../src'
import type { WorkflowScheduleSpec } from '@tanstack/workflow-runtime'

describe('Vercel workflow sweep adapter', () => {
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

  it('returns a Vercel-compatible route handler response', async () => {
    const runtime = createRuntime()
    const handler = createVercelWorkflowSweepHandler({
      runtime,
      now: () => 900_000,
      leaseOwner: 'vercel:test',
    })

    const response = await handler(
      new Request('https://example.com/api/workflow/sweep', {
        headers: {
          'user-agent': 'vercel-cron/1.0',
        },
      }),
    )
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
    expect(body.leaseOwner).toBe('vercel:test')
    expect(body.materialized).toHaveLength(1)
    expect(body.summary.materialized).toBe(1)
    expect(body.summary.scheduled.completed).toBe(1)
    expect(body.summary.returnedEventCount).toBe(0)
    expect(body.sweep).toBeUndefined()
  })

  it('can include the full runtime sweep result for debugging', async () => {
    const runtime = createRuntime()
    const handler = createVercelWorkflowSweepHandler({
      runtime,
      now: () => 900_000,
      leaseOwner: 'vercel:test',
      includeEvents: true,
      includeSweepResult: true,
    })

    const response = await handler(
      new Request('https://example.com/api/workflow/sweep'),
    )
    const body = (await response.json()) as {
      sweep?: {
        scheduled: ReadonlyArray<{ kind: string; events: Array<unknown> }>
      }
    }

    expect(body.sweep?.scheduled[0]?.kind).toBe('completed')
    expect(body.sweep?.scheduled[0]?.events.length).toBeGreaterThan(0)
  })

  it('supports Vercel CRON_SECRET authorization', async () => {
    const runtime = createRuntime()
    const handler = createVercelWorkflowSweepHandler({
      runtime,
      now: () => 900_000,
      cronSecret: 'secret',
    })

    const unauthorized = await handler(
      new Request('https://example.com/api/workflow/sweep'),
    )
    const authorized = await handler(
      new Request('https://example.com/api/workflow/sweep', {
        headers: {
          authorization: 'Bearer secret',
        },
      }),
    )

    expect(unauthorized.status).toBe(401)
    expect(authorized.status).toBe(200)
  })

  it('creates a default Vercel cron config', () => {
    expect(vercelWorkflowCronConfig).toEqual({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      crons: [
        {
          path: '/api/workflow/sweep',
          schedule: '*/5 * * * *',
        },
      ],
    })
    expect(
      createVercelWorkflowCronConfig({
        path: '/api/cron',
        everyMinutes: 1,
      }),
    ).toEqual({
      $schema: 'https://openapi.vercel.sh/vercel.json',
      crons: [
        {
          path: '/api/cron',
          schedule: '* * * * *',
        },
      ],
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
