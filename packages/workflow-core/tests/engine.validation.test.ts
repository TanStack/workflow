import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import { collect } from './test-utils'

describe('workflow schema validation', () => {
  it('validates and parses input before the handler runs', async () => {
    let handlerRan = false
    const wf = createWorkflow({
      id: 'input-validation',
      input: z.object({ count: z.number() }),
    }).handler(async (ctx) => {
      handlerRan = true
      return { count: ctx.input.count }
    })

    const events = await collect(
      runWorkflow({
        workflow: wf,
        input: { count: 'not-a-number' },
        runStore: inMemoryRunStore(),
      }),
    )

    expect(handlerRan).toBe(false)
    expect(events.find((e) => e.type === 'RUN_ERRORED')).toMatchObject({
      code: 'validation_error',
      error: { message: expect.stringContaining('input failed') },
    })
  })

  it('emits the parsed input value from schema defaults', async () => {
    const wf = createWorkflow({
      id: 'input-default',
      input: z.object({ count: z.number().default(1) }),
    }).handler(async (ctx) => {
      return { count: ctx.input.count }
    })

    const events = await collect(
      runWorkflow({
        workflow: wf,
        input: {},
        runStore: inMemoryRunStore(),
      }),
    )

    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { count: 1 },
    })
  })

  it('validates output before persisting RUN_FINISHED', async () => {
    const wf = createWorkflow({
      id: 'output-validation',
      output: z.object({ ok: z.boolean() }),
    }).handler(async () => {
      return { ok: 'nope' } as never
    })

    const events = await collect(
      runWorkflow({
        workflow: wf,
        input: {},
        runStore: inMemoryRunStore(),
      }),
    )

    expect(events.find((e) => e.type === 'RUN_FINISHED')).toBeUndefined()
    expect(events.find((e) => e.type === 'RUN_ERRORED')).toMatchObject({
      code: 'error',
      error: { message: expect.stringContaining('output failed') },
    })
  })
})
