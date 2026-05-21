import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createMiddleware,
  createWorkflow,
  inMemoryRunStore,
  runWorkflow,
} from '../src'
import { collect } from './test-utils'

describe('createMiddleware + workflow.middleware', () => {
  it('extends ctx with middleware-added fields', async () => {
    const requireUser = createMiddleware().server<{
      user: { id: string; name: string }
    }>(async ({ next }) => {
      return next({ context: { user: { id: 'u-1', name: 'Alice' } } })
    })

    const wf = createWorkflow({
      id: 'mw-extends',
      output: z.object({ userId: z.string(), userName: z.string() }),
    })
      .middleware([requireUser])
      .handler(async (ctx) => {
        return { userId: ctx.user.id, userName: ctx.user.name }
      })

    const events = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { userId: 'u-1', userName: 'Alice' },
    })
  })

  it('composes multiple middlewares in order, accumulating ctx fields', async () => {
    const m1 = createMiddleware().server<{ a: number }>(async ({ next }) => {
      return next({ context: { a: 1 } })
    })
    const m2 = createMiddleware<{ a: number }>().server<{ b: number }>(
      async ({ ctx, next }) => {
        return next({ context: { b: ctx.a + 10 } })
      },
    )

    const wf = createWorkflow({
      id: 'mw-chain',
      output: z.object({ sum: z.number() }),
    })
      .middleware([m1, m2])
      .handler(async (ctx) => {
        return { sum: ctx.a + ctx.b }
      })

    const events = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { sum: 12 },
    })
  })

  it('wraps the handler so middleware can run code before AND after', async () => {
    const events: Array<string> = []
    const m1 = createMiddleware().server(async ({ next }) => {
      events.push('m1-before')
      const out = await next({ context: {} })
      events.push('m1-after')
      return out
    })

    const wf = createWorkflow({ id: 'mw-wrap' })
      .middleware([m1])
      .handler(async (_ctx) => {
        events.push('handler')
        return {}
      })

    await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )
    expect(events).toEqual(['m1-before', 'handler', 'm1-after'])
  })

  it('rejects calling next() more than once in a middleware', async () => {
    const broken = createMiddleware().server(async ({ next }) => {
      await next({ context: {} })
      await next({ context: {} }) // second call — should throw
    })

    const wf = createWorkflow({ id: 'mw-broken' })
      .middleware([broken])
      .handler(async () => ({}))

    const result = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )
    const errored = result.find((e) => e.type === 'RUN_ERRORED')
    expect(errored).toMatchObject({
      error: { message: expect.stringMatching(/at most once/) },
    })
  })
})
