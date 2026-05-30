import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import {
  createMiddleware,
  createWorkflowFactory,
  inMemoryRunStore,
  runWorkflow,
} from '../src'
import { collect } from './test-utils'

describe('createWorkflowFactory', () => {
  it('applies factory middlewares to every workflow it produces', async () => {
    const requireUser = createMiddleware().server<{
      user: { id: string }
    }>(async ({ next }) => {
      return next({ context: { user: { id: 'u-1' } } })
    })

    const appWorkflow = createWorkflowFactory().middleware([requireUser])

    const wf = appWorkflow({
      id: 'factory-mw',
      output: z.object({ userId: z.string() }),
    }).handler(async (ctx) => {
      return { userId: ctx.user.id }
    })

    const events = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { userId: 'u-1' },
    })
  })

  it('runs factory middlewares before per-workflow middlewares', async () => {
    const order: Array<string> = []
    const a = createMiddleware().server(async ({ next }) => {
      order.push('a-before')
      const out = await next({ context: {} })
      order.push('a-after')
      return out
    })
    const b = createMiddleware().server(async ({ next }) => {
      order.push('b-before')
      const out = await next({ context: {} })
      order.push('b-after')
      return out
    })
    const c = createMiddleware().server(async ({ next }) => {
      order.push('c-before')
      const out = await next({ context: {} })
      order.push('c-after')
      return out
    })

    const appWorkflow = createWorkflowFactory().middleware([a, b])
    const wf = appWorkflow({ id: 'factory-order' })
      .middleware([c])
      .handler(async () => {
        order.push('handler')
        return {}
      })

    await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )
    expect(order).toEqual([
      'a-before',
      'b-before',
      'c-before',
      'handler',
      'c-after',
      'b-after',
      'a-after',
    ])
  })

  it('accumulates ctx across factory + per-workflow middlewares', async () => {
    const m1 = createMiddleware().server<{ a: number }>(async ({ next }) => {
      return next({ context: { a: 1 } })
    })
    const m2 = createMiddleware<{ a: number }>().server<{ b: number }>(
      async ({ ctx, next }) => {
        return next({ context: { b: ctx.a + 10 } })
      },
    )

    const appWorkflow = createWorkflowFactory().middleware([m1])
    const wf = appWorkflow({
      id: 'factory-accumulate',
      output: z.object({ sum: z.number() }),
    })
      .middleware([m2])
      .handler(async (ctx) => {
        expectTypeOf(ctx.a).toEqualTypeOf<number>()
        expectTypeOf(ctx.b).toEqualTypeOf<number>()
        return { sum: ctx.a + ctx.b }
      })

    const events = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { sum: 12 },
    })
  })

  it('merges defaults onto config, with per-workflow values winning', async () => {
    const factoryRetry = { maxAttempts: 5 }
    const overrideRetry = { maxAttempts: 2 }

    const f = createWorkflowFactory({ defaultStepRetry: factoryRetry })

    // factory default applies when config does not set it
    const wfA = f({ id: 'factory-default-a' }).handler(async () => ({}))
    expect(wfA.defaultStepRetry).toEqual(factoryRetry)

    // per-workflow value wins
    const wfB = f({
      id: 'factory-default-b',
      defaultStepRetry: overrideRetry,
    }).handler(async () => ({}))
    expect(wfB.defaultStepRetry).toEqual(overrideRetry)
  })

  it('extend() can override factory defaults', () => {
    const parent = createWorkflowFactory({
      defaultStepRetry: { maxAttempts: 3 },
    })
    const child = parent.extend({ defaultStepRetry: { maxAttempts: 7 } })

    const parentWf = parent({ id: 'inherit-parent' }).handler(async () => ({}))
    const childWf = child({ id: 'inherit-child' }).handler(async () => ({}))

    expect(parentWf.defaultStepRetry).toEqual({ maxAttempts: 3 })
    expect(childWf.defaultStepRetry).toEqual({ maxAttempts: 7 })
  })

  it('extend() forks state without mutating the parent', () => {
    const m1 = createMiddleware().server<{ a: number }>(async ({ next }) =>
      next({ context: { a: 1 } }),
    )
    const m2 = createMiddleware().server<{ b: number }>(async ({ next }) =>
      next({ context: { b: 2 } }),
    )

    const parent = createWorkflowFactory().middleware([m1])
    const child = parent.extend().middleware([m2])

    const childWf = child({
      id: 'fork-child',
      output: z.object({ a: z.number(), b: z.number() }),
    }).handler(async (ctx) => ({ a: ctx.a, b: ctx.b }))

    const parentWf = parent({
      id: 'fork-parent',
      output: z.object({ a: z.number() }),
    }).handler(async (ctx) => {
      // @ts-expect-error parent factory has no `b` extension
      ctx.b
      return { a: ctx.a }
    })

    expect(childWf.middlewares).toHaveLength(2)
    expect(parentWf.middlewares).toHaveLength(1)
  })

  it('chains .middleware() calls on the factory itself', async () => {
    const m1 = createMiddleware().server<{ a: number }>(async ({ next }) =>
      next({ context: { a: 1 } }),
    )
    const m2 = createMiddleware().server<{ b: number }>(async ({ next }) =>
      next({ context: { b: 2 } }),
    )

    const f = createWorkflowFactory().middleware([m1]).middleware([m2])

    const wf = f({
      id: 'factory-chain',
      output: z.object({ sum: z.number() }),
    }).handler(async (ctx) => ({ sum: ctx.a + ctx.b }))

    const events = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { sum: 3 },
    })
  })

  it('produces a builder usable with no per-workflow middleware', async () => {
    const requireUser = createMiddleware().server<{
      user: { id: string }
    }>(async ({ next }) => next({ context: { user: { id: 'u-9' } } }))

    const f = createWorkflowFactory().middleware([requireUser])

    const wf = f({
      id: 'no-extra-mw',
      output: z.object({ id: z.string() }),
    }).handler(async (ctx) => ({ id: ctx.user.id }))

    const events = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { id: 'u-9' },
    })
  })

  it('an empty factory is equivalent to createWorkflow', async () => {
    const f = createWorkflowFactory()
    const wf = f({
      id: 'empty-factory',
      output: z.object({ ok: z.boolean() }),
    }).handler(async () => ({ ok: true }))

    expect(wf.middlewares).toEqual([])
    expect(wf.defaultStepRetry).toBeUndefined()

    const events = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { ok: true },
    })
  })
})
