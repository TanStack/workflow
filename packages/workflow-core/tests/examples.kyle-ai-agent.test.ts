/**
 * Port of Kyle Mathews's "aiAgent" example from the TanStack Workflow
 * RFC (lines 246-298). An AI agent that:
 *   1. generates a step-by-step plan
 *   2. waits for user approval of the plan
 *   3. executes each step, with per-step confirmation when the
 *      tool call has side effects
 *
 * Original used `createChat({...})` directly inside `step.run` and
 * referenced `step.run`/`waitForEvent` as destructured args. The
 * port replaces the LLM calls with deterministic stubs and reaches
 * primitives through `ctx`.
 *
 * Demonstrates:
 *   - Loops over a plan with per-iteration durable steps
 *   - Conditional per-step confirmation pauses
 *   - Skip / continue behavior when a confirmation is denied
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import { collect, findRunId } from './test-utils'

interface PlanStep {
  id: string
  action: string
  requiresConfirmation: boolean
}

interface AgentChat {
  generatePlan: (task: string) => Promise<{ steps: Array<PlanStep> }>
  executeStep: (planStep: PlanStep) => Promise<{
    output: string
    side: 'pure' | 'mutated'
  }>
}

function makeAiAgentWorkflow(chat: AgentChat) {
  return createWorkflow({
    id: 'ai-agent',
    input: z.object({ task: z.string() }),
  }).handler(async (ctx) => {
    // 1. Generate plan
    const plan = await ctx.step('generate-plan', () =>
      chat.generatePlan(ctx.input.task),
    )

    // 2. Wait for user to approve the plan
    const approval = await ctx.approve({
      title: 'Approve plan?',
      description: `${plan.steps.length} steps proposed.`,
    })
    if (!approval.approved) {
      return {
        status: 'cancelled' as const,
        reason: approval.feedback ?? 'plan rejected',
      }
    }

    // 3. Execute each step
    const results: Array<{ id: string; output: string; skipped: boolean }> = []
    for (const planStep of plan.steps) {
      const toolResult = await ctx.step(`execute-${planStep.id}`, () =>
        chat.executeStep(planStep),
      )

      // If the tool has side effects, pause for per-step confirmation.
      if (planStep.requiresConfirmation) {
        const confirm = await ctx.waitForEvent(`confirm-${planStep.id}`, {
          schema: z.object({ proceed: z.boolean() }),
          meta: { stepId: planStep.id, output: toolResult.output },
        })
        if (!confirm.proceed) {
          results.push({
            id: planStep.id,
            output: toolResult.output,
            skipped: true,
          })
          continue
        }
      }

      results.push({
        id: planStep.id,
        output: toolResult.output,
        skipped: false,
      })
    }

    return { status: 'completed' as const, results }
  })
}

const plan: Array<PlanStep> = [
  { id: 's1', action: 'read file', requiresConfirmation: false },
  { id: 's2', action: 'write file', requiresConfirmation: true },
  { id: 's3', action: 'send email', requiresConfirmation: true },
]

const stubChat: AgentChat = {
  generatePlan: async () => ({ steps: plan }),
  executeStep: async (planStep) => ({
    output: `did: ${planStep.action}`,
    side: planStep.requiresConfirmation ? 'mutated' : 'pure',
  }),
}

describe('example: Kyle aiAgent workflow ported to closure API', () => {
  it('plan rejected → workflow returns cancelled without executing any step', async () => {
    const wf = makeAiAgentWorkflow(stubChat)
    const store = inMemoryRunStore()

    const phase1 = await collect(
      runWorkflow({
        workflow: wf,
        input: { task: 'do everything' },
        runStore: store,
      }),
    )
    const runId = findRunId(phase1)
    expect(phase1.find((e) => e.type === 'APPROVAL_REQUESTED')).toBeDefined()

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: {
          approvalId: 'a-1',
          approved: false,
          feedback: 'too risky',
        },
        runStore: store,
      }),
    )
    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { status: 'cancelled', reason: 'too risky' },
    })
  })

  it('plan approved, all per-step confirms approved → all steps executed', async () => {
    const wf = makeAiAgentWorkflow(stubChat)
    const store = inMemoryRunStore()

    // Approve plan
    const phase1 = await collect(
      runWorkflow({
        workflow: wf,
        input: { task: 'process invoices' },
        runStore: store,
      }),
    )
    const runId = findRunId(phase1)

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: { approvalId: 'a-1', approved: true },
        runStore: store,
      }),
    )
    // Now waiting on the first confirm (s2 — write file)
    expect(phase2.find((e) => e.type === 'SIGNAL_AWAITED')).toMatchObject({
      name: 'confirm-s2',
    })

    // Confirm s2
    const phase3 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        signalDelivery: {
          signalId: 'c-s2',
          name: 'confirm-s2',
          payload: { proceed: true },
        },
        runStore: store,
      }),
    )
    expect(phase3.find((e) => e.type === 'SIGNAL_AWAITED')).toMatchObject({
      name: 'confirm-s3',
    })

    // Confirm s3
    const phase4 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        signalDelivery: {
          signalId: 'c-s3',
          name: 'confirm-s3',
          payload: { proceed: true },
        },
        runStore: store,
      }),
    )
    expect(phase4.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: {
        status: 'completed',
        results: [
          { id: 's1', skipped: false },
          { id: 's2', skipped: false },
          { id: 's3', skipped: false },
        ],
      },
    })
  })

  it('per-step confirm denied → step is marked skipped, loop continues', async () => {
    const wf = makeAiAgentWorkflow(stubChat)
    const store = inMemoryRunStore()

    const phase1 = await collect(
      runWorkflow({
        workflow: wf,
        input: { task: 'process invoices' },
        runStore: store,
      }),
    )
    const runId = findRunId(phase1)

    await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: { approvalId: 'a-1', approved: true },
        runStore: store,
      }),
    )

    // Deny s2 (write file)
    await collect(
      runWorkflow({
        workflow: wf,
        runId,
        signalDelivery: {
          signalId: 'c-s2',
          name: 'confirm-s2',
          payload: { proceed: false },
        },
        runStore: store,
      }),
    )

    // Approve s3
    const final = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        signalDelivery: {
          signalId: 'c-s3',
          name: 'confirm-s3',
          payload: { proceed: true },
        },
        runStore: store,
      }),
    )
    expect(final.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: {
        status: 'completed',
        results: [
          { id: 's1', skipped: false },
          { id: 's2', skipped: true },
          { id: 's3', skipped: false },
        ],
      },
    })
  })
})
