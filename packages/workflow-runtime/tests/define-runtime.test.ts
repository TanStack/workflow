import { describe, expect, expectTypeOf, it } from 'vitest'
import { cron, defineWorkflowRuntime, every } from '../src'
import type { AnyWorkflowDefinition } from '@tanstack/workflow-core'
import type { WorkflowExecutionStore } from '../src'

describe('workflow runtime definitions', () => {
  it('preserves runtime workflow registration keys', () => {
    const store = {} as WorkflowExecutionStore
    const workflow = {
      __kind: 'workflow',
      id: 'intent-process',
      middlewares: [],
      handler: async () => {
        await Promise.resolve()
        return undefined
      },
    } satisfies AnyWorkflowDefinition

    const runtime = defineWorkflowRuntime({
      store,
      workflows: {
        'intent-process': {
          load: async () => {
            await Promise.resolve()
            return workflow
          },
          schedules: [
            {
              schedule: every.minutes(15),
              overlapPolicy: 'skip',
            },
          ],
        },
      },
    })

    expect(runtime.__kind).toBe('workflow-runtime')
    expect(runtime.workflows['intent-process'].schedules[0].schedule).toEqual({
      kind: 'interval',
      everyMs: 15 * 60 * 1000,
    })
    expectTypeOf(runtime.workflows['intent-process']).toHaveProperty('load')
  })

  it('defines cron schedules with explicit timezones', () => {
    expect(cron('0 9 * * MON', { timezone: 'UTC' })).toEqual({
      kind: 'cron',
      expression: '0 9 * * MON',
      timezone: 'UTC',
    })
  })
})
