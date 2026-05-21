/**
 * Port of Kyle Mathews's "expenseApproval" example from the TanStack
 * Workflow RFC
 * (https://gist.github.com/KyleAMathews/1421c5cdfd060f6caaaf67b0dc42bd49,
 * lines 156-192).
 *
 * Original (Kyle's proposed API):
 *
 *     export const expenseApproval = createWorkflow({
 *       id: 'expense-approval',
 *       input: z.object({ amount, description, submittedBy }),
 *     }).handler(async ({ input, step, sleep, waitForEvent }) => {
 *       const validated = await step.run('validate', () => validateExpense(input))
 *       if (input.amount > 1000) {
 *         const approval = await waitForEvent('manager-approval', { timeout: '48 hours' })
 *         if (!approval.approved) return { status: 'rejected', reason: approval.reason }
 *       }
 *       const result = await step.run('process', () => processReimbursement(validated))
 *       return { status: 'approved', result }
 *     })
 *
 * The closure API matches Kyle's intent almost verbatim — the only
 * shape change is `step.run(...)` → `ctx.step(...)` and `waitForEvent`
 * is reached through `ctx`. Primitives live on the ctx object rather
 * than being destructured from the handler arg.
 *
 * Demonstrates:
 *   - Conditional pause based on input
 *   - Typed payload from `waitForEvent` via schema
 *   - Discriminated-union output
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import { collect, findRunId } from './test-utils'

interface ValidatedExpense {
  amount: number
  description: string
  submittedBy: string
  validatedAt: number
}

interface ReimbursementResult {
  reference: string
  amount: number
}

// Stubs that would call real domain services in production.
async function validateExpense(input: {
  amount: number
  description: string
  submittedBy: string
}): Promise<ValidatedExpense> {
  return { ...input, validatedAt: 1_700_000_000 }
}

async function processReimbursement(
  validated: ValidatedExpense,
): Promise<ReimbursementResult> {
  return {
    reference: `RE-${validated.submittedBy}-${validated.amount}`,
    amount: validated.amount,
  }
}

const expenseApproval = createWorkflow({
  id: 'expense-approval',
  input: z.object({
    amount: z.number(),
    description: z.string(),
    submittedBy: z.string(),
  }),
}).handler(async (ctx) => {
  const validated = await ctx.step('validate', () =>
    validateExpense(ctx.input),
  )

  // Auto-approve small expenses; large ones require a manager.
  if (ctx.input.amount > 1000) {
    const approval = await ctx.waitForEvent('manager-approval', {
      schema: z.object({
        approved: z.boolean(),
        reason: z.string().optional(),
      }),
    })

    if (!approval.approved) {
      return {
        status: 'rejected' as const,
        reason: approval.reason ?? 'no reason given',
      }
    }
  }

  const result = await ctx.step('process', () =>
    processReimbursement(validated),
  )

  return { status: 'approved' as const, result }
})

describe('example: Kyle expense approval workflow ported to closure API', () => {
  it('small expense (≤ 1000): no approval needed, run finishes immediately', async () => {
    const events = await collect(
      runWorkflow({
        workflow: expenseApproval,
        input: {
          amount: 250,
          description: 'Lunch with client',
          submittedBy: 'alice@example.com',
        },
        runStore: inMemoryRunStore(),
      }),
    )
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: {
        status: 'approved',
        result: { amount: 250, reference: 'RE-alice@example.com-250' },
      },
    })
    // No approval was awaited.
    expect(events.find((e) => e.type === 'SIGNAL_AWAITED')).toBeUndefined()
  })

  it('large expense (> 1000): pauses on manager-approval, resumes on delivery', async () => {
    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({
        workflow: expenseApproval,
        input: {
          amount: 1500,
          description: 'Team offsite dinner',
          submittedBy: 'bob@example.com',
        },
        runStore: store,
      }),
    )
    const runId = findRunId(phase1)
    expect(phase1.find((e) => e.type === 'SIGNAL_AWAITED')).toMatchObject({
      name: 'manager-approval',
    })

    const phase2 = await collect(
      runWorkflow({
        workflow: expenseApproval,
        runId,
        signalDelivery: {
          signalId: 'mgr-approval-1',
          name: 'manager-approval',
          payload: { approved: true },
        },
        runStore: store,
      }),
    )
    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: {
        status: 'approved',
        result: { amount: 1500 },
      },
    })
  })

  it('large expense rejected: returns rejected with reason', async () => {
    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({
        workflow: expenseApproval,
        input: {
          amount: 5000,
          description: 'Replacement laptop',
          submittedBy: 'charlie@example.com',
        },
        runStore: store,
      }),
    )
    const runId = findRunId(phase1)

    const phase2 = await collect(
      runWorkflow({
        workflow: expenseApproval,
        runId,
        signalDelivery: {
          signalId: 'mgr-reject-1',
          name: 'manager-approval',
          payload: { approved: false, reason: 'Over quarterly budget' },
        },
        runStore: store,
      }),
    )
    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { status: 'rejected', reason: 'Over quarterly budget' },
    })
  })
})
