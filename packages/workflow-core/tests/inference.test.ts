/**
 * Inference contract — proves that workflow authors can write plain
 * JS-shaped handlers and still get end-to-end type safety, with no
 * explicit ctx / step / waitForEvent / output annotations.
 *
 * Every check in this file is locked in with `expectTypeOf`. If any
 * future engine change breaks inference flow, these tests fail at
 * compile time.
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import {
  createMiddleware,
  createWorkflow,
  inMemoryRunStore,
  runWorkflow,
} from '../src'
import type {
  ApprovalResult,
  WorkflowInput,
  WorkflowOutput,
  WorkflowState,
} from '../src'
import { collect, findRunId } from './test-utils'

// ============================================================
// The "AI can write this with zero annotations" example.
//
// Note the handler signature: `async (ctx) => { ... }`. No type
// annotations on `ctx`, on step fns, on the waitForEvent payload,
// or on the return value.
// ============================================================

const requireUser = createMiddleware().server<{
  user: { id: string; tier: 'free' | 'pro' }
}>(async ({ next }) => {
  return next({ context: { user: { id: 'u-1', tier: 'pro' } } })
})

const traced = createMiddleware<{ user: { id: string } }>().server<{
  trace: { spans: Array<string> }
}>(async ({ next }) => {
  return next({ context: { trace: { spans: [] } } })
})

const order = createWorkflow({
  id: 'order',
  input: z.object({
    productId: z.string(),
    quantity: z.number().int().min(1),
  }),
  state: z.object({
    status: z
      .enum(['pending', 'reserving', 'reserved', 'fulfilled'])
      .default('pending'),
    inventoryReservationId: z.string().optional(),
  }),
})
  .middleware([requireUser, traced])
  .handler(async (ctx) => {
    // Every reference below is fully typed by inference. The only
    // "annotation" anywhere in this body is `as const` on the
    // discriminator literal, which AI codegen handles naturally.

    ctx.state.status = 'reserving'

    const reservation = await ctx.step('reserve', () => ({
      id: `rsv-${ctx.input.productId}`,
      sku: ctx.input.productId,
      qty: ctx.input.quantity,
    }))

    ctx.state.inventoryReservationId = reservation.id
    ctx.state.status = 'reserved'
    ctx.trace.spans.push('reserved')

    const payment = await ctx.waitForEvent('payment-completed', {
      schema: z.object({
        amount: z.number(),
        reference: z.string(),
        method: z.enum(['card', 'wire', 'crypto']),
      }),
    })

    const decision = await ctx.approve({ title: 'Fulfill?' })

    if (!decision.approved) {
      return { ok: false as const, reason: 'denied' }
    }

    ctx.state.status = 'fulfilled'
    return {
      ok: true as const,
      orderId: ctx.runId,
      paymentReference: payment.reference,
      userId: ctx.user.id,
      paymentMethod: payment.method,
    }
  })

// ============================================================
// Type-level locks
// ============================================================

describe('inference — workflow author writes plain JS, types still flow', () => {
  it('infers input type at the workflow-definition level', () => {
    expectTypeOf<WorkflowInput<typeof order>>().toEqualTypeOf<{
      productId: string
      quantity: number
    }>()
  })

  it('infers state type at the workflow-definition level', () => {
    expectTypeOf<WorkflowState<typeof order>>().toEqualTypeOf<{
      status: 'pending' | 'reserving' | 'reserved' | 'fulfilled'
      inventoryReservationId?: string | undefined
    }>()
  })

  it('infers the discriminated-union output from the handler return', () => {
    type Output = WorkflowOutput<typeof order>
    // `toMatchTypeOf` (assignability) handles the union shape cleanly.
    // The narrower per-branch literals — `ok: false` vs `ok: true`,
    // and the enum on `paymentMethod` — flow through.
    expectTypeOf<Output>().toMatchTypeOf<
      | { ok: false; reason: string }
      | {
          ok: true
          orderId: string
          paymentReference: string
          userId: string
          paymentMethod: 'card' | 'wire' | 'crypto'
        }
    >()
  })

  it('infers ctx.input from the input schema (no annotation on the handler)', () => {
    const wf = createWorkflow({
      id: 'inferred-input',
      input: z.object({ x: z.number(), y: z.string() }),
    }).handler(async (ctx) => {
      expectTypeOf(ctx.input).toEqualTypeOf<{ x: number; y: string }>()
      return null
    })
    void wf
  })

  it('infers ctx.state from the state schema, with literal narrowing on enum fields', () => {
    const wf = createWorkflow({
      id: 'inferred-state',
      state: z.object({
        status: z.enum(['idle', 'running', 'done']).default('idle'),
        count: z.number().default(0),
      }),
    }).handler(async (ctx) => {
      expectTypeOf(ctx.state.status).toEqualTypeOf<
        'idle' | 'running' | 'done'
      >()
      expectTypeOf(ctx.state.count).toEqualTypeOf<number>()
      ctx.state.status = 'running'
      // @ts-expect-error 'nope' is not in the enum
      ctx.state.status = 'nope'
      return null
    })
    void wf
  })

  it('flows step fn return types through `await ctx.step(id, fn)`', () => {
    const wf = createWorkflow({ id: 'inferred-step' }).handler(async (ctx) => {
      const a = await ctx.step('a', () => 'hello')
      expectTypeOf(a).toEqualTypeOf<string>()

      const b = await ctx.step('b', () => ({ count: 42, label: 'x' }))
      expectTypeOf(b).toEqualTypeOf<{ count: number; label: string }>()

      const c = await ctx.step('c', async () => [1, 2, 3])
      expectTypeOf(c).toEqualTypeOf<Array<number>>()

      // Step ctx itself is typed.
      await ctx.step('d', (stepCtx) => {
        expectTypeOf(stepCtx.id).toEqualTypeOf<string>()
        expectTypeOf(stepCtx.attempt).toEqualTypeOf<number>()
        expectTypeOf(stepCtx.signal).toEqualTypeOf<AbortSignal>()
        return null
      })

      return null
    })
    void wf
  })

  it('infers ctx.waitForEvent payload from the optional schema', () => {
    const wf = createWorkflow({ id: 'inferred-wait' }).handler(async (ctx) => {
      const payload = await ctx.waitForEvent('approve', {
        schema: z.object({ approved: z.boolean(), notes: z.string() }),
      })
      expectTypeOf(payload).toEqualTypeOf<{
        approved: boolean
        notes: string
      }>()

      // No schema → payload is the generic param, default `unknown`.
      const raw = await ctx.waitForEvent('webhook')
      expectTypeOf(raw).toEqualTypeOf<unknown>()

      // Generic param wins when explicitly passed.
      const explicit = await ctx.waitForEvent<{ kind: 'a' | 'b' }>('event')
      expectTypeOf(explicit).toEqualTypeOf<{ kind: 'a' | 'b' }>()

      return null
    })
    void wf
  })

  it('ctx.approve returns ApprovalResult', () => {
    const wf = createWorkflow({ id: 'inferred-approve' }).handler(
      async (ctx) => {
        const d = await ctx.approve({ title: 'go?' })
        expectTypeOf(d).toEqualTypeOf<ApprovalResult>()
        expectTypeOf(d.approved).toEqualTypeOf<boolean>()
        expectTypeOf(d.feedback).toEqualTypeOf<string | undefined>()
        return null
      },
    )
    void wf
  })

  it('ctx.now / ctx.uuid have the right inferred types', () => {
    const wf = createWorkflow({ id: 'inferred-deterministic' }).handler(
      async (ctx) => {
        const ts = await ctx.now()
        expectTypeOf(ts).toEqualTypeOf<number>()

        const id = await ctx.uuid()
        expectTypeOf(id).toEqualTypeOf<string>()

        return null
      },
    )
    void wf
  })

  it('exposes middleware-added fields on ctx with proper types', () => {
    const mw = createMiddleware().server<{
      db: { query: (sql: string) => Array<{ id: string }> }
    }>(async ({ next }) =>
      next({ context: { db: { query: () => [] } } }),
    )

    const wf = createWorkflow({ id: 'inferred-mw' })
      .middleware([mw])
      .handler(async (ctx) => {
        expectTypeOf(ctx.db.query).toEqualTypeOf<
          (sql: string) => Array<{ id: string }>
        >()
        return null
      })
    void wf
  })

  it('accumulates middleware extensions in chain order', () => {
    const m1 = createMiddleware().server<{ a: number }>(async ({ next }) =>
      next({ context: { a: 1 } }),
    )
    const m2 = createMiddleware<{ a: number }>().server<{ b: string }>(
      async ({ next }) => next({ context: { b: 'x' } }),
    )

    const wf = createWorkflow({ id: 'inferred-chain' })
      .middleware([m1, m2])
      .handler(async (ctx) => {
        expectTypeOf(ctx.a).toEqualTypeOf<number>()
        expectTypeOf(ctx.b).toEqualTypeOf<string>()
        return null
      })
    void wf
  })

  it('output schema constrains but inferred type narrows further', () => {
    const wf = createWorkflow({
      id: 'inferred-output',
      output: z.object({ ok: z.boolean() }),
    }).handler(async () => {
      return { ok: true as const, extraField: 'allowed' }
    })

    // The schema said { ok: boolean } but the handler returned the
    // narrower shape — WorkflowOutput carries the narrower type for
    // downstream consumers.
    expectTypeOf<WorkflowOutput<typeof wf>>().toEqualTypeOf<{
      ok: true
      extraField: string
    }>()
  })

  it('rejects handler returns that violate the output schema', () => {
    createWorkflow({
      id: 'output-violation',
      output: z.object({ ok: z.boolean() }),
      // @ts-expect-error returning a string is not assignable to { ok: boolean }
    }).handler(async () => 'nope')
  })
})

// ============================================================
// Runtime verification — the inferred-only workflow actually runs.
// ============================================================

describe('inference — example order workflow runs end-to-end', () => {
  it('drives the order workflow through pause → resume → approve → finish', async () => {
    const store = inMemoryRunStore()

    const phase1 = await collect(
      runWorkflow({
        workflow: order,
        input: { productId: 'sku-1', quantity: 3 },
        runStore: store,
      }),
    )
    const runId = findRunId(phase1)
    expect(phase1.find((e) => e.type === 'SIGNAL_AWAITED')).toMatchObject({
      name: 'payment-completed',
    })

    const phase2 = await collect(
      runWorkflow({
        workflow: order,
        runId,
        signalDelivery: {
          signalId: 'pay-1',
          name: 'payment-completed',
          payload: { amount: 99.99, reference: 'PAY-XYZ', method: 'card' },
        },
        runStore: store,
      }),
    )
    expect(phase2.find((e) => e.type === 'APPROVAL_REQUESTED')).toBeDefined()

    const phase3 = await collect(
      runWorkflow({
        workflow: order,
        runId,
        approval: { approvalId: 'a-1', approved: true },
        runStore: store,
      }),
    )

    const finished = phase3.find((e) => e.type === 'RUN_FINISHED')
    expect(finished).toMatchObject({
      output: {
        ok: true,
        orderId: runId,
        paymentReference: 'PAY-XYZ',
        userId: 'u-1',
        paymentMethod: 'card',
      },
    })
  })
})
