/**
 * Port of Alem's feature orchestrator from TanStack/ai PR #542
 * (`examples/ts-react-chat/src/lib/workflows/orchestrator.ts`).
 *
 * Original shape: a `defineOrchestrator` + `defineRouter` pair where
 * the router dispatches one of four "agents" — spec / approve /
 * implement (a sub-workflow) / review — based on a triage agent's
 * decision. Each chat-message turn triggers a fresh orchestrator
 * invocation that carries the spec/result forward via `previousSpec`
 * / `previousResult` in the input.
 *
 * In the closure API, the router becomes a plain switch statement
 * inside the handler. The orchestrator is just a `createWorkflow`
 * with control flow that branches on the triage result. Sub-
 * workflows (`implement`) are inlined as ordinary `ctx.step` calls;
 * a future nested-workflow primitive would let us re-use the
 * `implementWorkflow` definition unchanged, but inlining is fine
 * for this port.
 *
 * Demonstrates:
 *   - Dynamic dispatch driven by AI-style decisions
 *   - Multi-branch state machine in a single handler
 *   - Pause-on-approve with denied-with-feedback re-routing
 *   - Carry-forward state across user-message turns via input
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import { collect, findRunId } from './test-utils'

// ============================================================
// Schemas — direct ports
// ============================================================

const FeatureSpec = z.object({
  title: z.string(),
  summary: z.string(),
  files: z.array(z.string()),
})

const FilePatch = z.object({
  filename: z.string(),
  patch: z.string(),
})

const ImplementResult = z.object({
  patches: z.array(FilePatch),
  rationale: z.string(),
})

const OrchestratorState = z.object({
  phase: z
    .enum(['scoping', 'awaiting-approval', 'implementing', 'review', 'done'])
    .default('scoping'),
  spec: FeatureSpec.optional(),
  result: ImplementResult.optional(),
  lastUserMessage: z.string().default(''),
  pendingFeedback: z.string().default(''),
})

const OrchestratorInput = z.object({
  userMessage: z.string(),
  previousSpec: FeatureSpec.optional(),
  previousResult: ImplementResult.optional(),
})

type SpecT = z.infer<typeof FeatureSpec>
type ResultT = z.infer<typeof ImplementResult>
type PatchT = z.infer<typeof FilePatch>

// ============================================================
// "Agent" implementations — plain functions, mocked here.
// ============================================================

interface OrchestratorAgents {
  triage: (args: {
    pendingFeedback: string
    phase: string
    hasSpec: boolean
    hasResult: boolean
  }) => Promise<{
    next: 'spec' | 'await-approval' | 'implement' | 'review' | 'done'
    reason: string
  }>
  spec: (args: {
    userMessage: string
    existingSpec?: SpecT
  }) => Promise<{ spec: SpecT; ready: boolean }>
  planner: (args: { spec: SpecT }) => Promise<{
    files: Array<string>
    rationale: string
  }>
  coder: (args: { filename: string; spec: SpecT }) => Promise<PatchT>
  review: (args: { result: ResultT; userMessage: string }) => Promise<{
    verdict: 'accept' | 'refine' | 'reject'
    notes: string
  }>
}

function makeOrchestrator(agents: OrchestratorAgents) {
  return createWorkflow({
    id: 'feature-orchestrator',
    input: OrchestratorInput,
    state: OrchestratorState,
    initialize: ({ input }) => {
      if (input.previousSpec) {
        return {
          lastUserMessage: input.userMessage,
          pendingFeedback: input.userMessage,
          spec: input.previousSpec,
          result: input.previousResult,
          phase: 'review' as const,
        }
      }
      return {
        lastUserMessage: input.userMessage,
        pendingFeedback: input.userMessage,
      }
    },
  }).handler(async (ctx) => {
    // Triage: decide what to do this turn.
    const triage = await ctx.step('triage', () =>
      agents.triage({
        pendingFeedback: ctx.state.pendingFeedback,
        phase: ctx.state.phase,
        hasSpec: !!ctx.state.spec,
        hasResult: !!ctx.state.result,
      }),
    )

    if (triage.next === 'done') {
      ctx.state.phase = 'done'
      return {
        phase: ctx.state.phase,
        result: ctx.state.result,
        reason: triage.reason,
      }
    }

    if (triage.next === 'spec') {
      ctx.state.phase = 'scoping'
      const { spec } = await ctx.step('spec', () =>
        agents.spec({
          userMessage: ctx.state.pendingFeedback || ctx.state.lastUserMessage,
          existingSpec: ctx.state.spec,
        }),
      )
      ctx.state.spec = spec
      // Clear pendingFeedback so the next turn's triage doesn't loop
      // back to spec against the same note.
      ctx.state.pendingFeedback = ''
      // A new spec invalidates any prior implementation.
      ctx.state.result = undefined
      return {
        phase: ctx.state.phase,
        result: ctx.state.result,
        reason: 'spec drafted',
      }
    }

    if (triage.next === 'await-approval') {
      ctx.state.phase = 'awaiting-approval'
      const approval = await ctx.approve({
        title: 'Start implementation?',
        description: ctx.state.spec
          ? `Spec ready: "${ctx.state.spec.title}". Approve to implement, or deny with feedback to refine.`
          : 'Begin implementing?',
      })

      if (approval.approved) {
        // Approved — proceed to implementation in the SAME run.
        if (!ctx.state.spec) {
          throw new Error('Approval granted but no spec to implement')
        }
        ctx.state.phase = 'implementing'
        const result = await runImplementation(ctx, agents, ctx.state.spec)
        ctx.state.result = result
        return {
          phase: ctx.state.phase,
          result,
          reason: 'implemented after approval',
        }
      }

      // Denied — route back to spec carrying any feedback.
      ctx.state.phase = 'scoping'
      const feedback = approval.feedback?.trim()
      ctx.state.pendingFeedback = feedback || 'refine the spec'
      const { spec } = await ctx.step('spec-after-deny', () =>
        agents.spec({
          userMessage: ctx.state.pendingFeedback,
          existingSpec: ctx.state.spec,
        }),
      )
      ctx.state.spec = spec
      ctx.state.pendingFeedback = ''
      ctx.state.result = undefined
      return {
        phase: ctx.state.phase,
        result: ctx.state.result,
        reason: 'spec refined after denial',
      }
    }

    if (triage.next === 'implement') {
      if (!ctx.state.spec) throw new Error('Triage requested implement but no spec')
      ctx.state.phase = 'implementing'
      const result = await runImplementation(ctx, agents, ctx.state.spec)
      ctx.state.result = result
      return { phase: ctx.state.phase, result, reason: 'implemented' }
    }

    if (triage.next === 'review') {
      if (!ctx.state.result) {
        throw new Error('Triage requested review but no result')
      }
      ctx.state.phase = 'review'
      const review = await ctx.step('review', () =>
        agents.review({
          result: ctx.state.result!,
          userMessage: ctx.state.lastUserMessage,
        }),
      )
      return {
        phase: ctx.state.phase,
        result: ctx.state.result,
        review,
        reason: 'reviewed',
      }
    }

    ctx.state.phase = 'done'
    return {
      phase: ctx.state.phase,
      result: ctx.state.result,
      reason: 'fallthrough',
    }
  })
}

/**
 * Sub-workflow inlined as a plain async function. In production
 * code this would be a separate `createWorkflow` invoked through a
 * nested-workflow primitive — the workflow-core engine currently
 * inlines it as a regular sequence of `ctx.step` calls.
 */
async function runImplementation(
  // Loose ctx type — this helper only needs `ctx.step`.
  ctx: { step: <T>(id: string, fn: () => T | Promise<T>) => Promise<T> },
  agents: OrchestratorAgents,
  spec: SpecT,
): Promise<ResultT> {
  const plan = await ctx.step('plan', () => agents.planner({ spec }))
  const patches: Array<PatchT> = []
  for (const filename of plan.files) {
    const patch = await ctx.step(`code-${filename}`, () =>
      agents.coder({ filename, spec }),
    )
    patches.push(patch)
  }
  return { patches, rationale: plan.rationale }
}

// ============================================================
// Deterministic mocks
// ============================================================

const baseAgents: OrchestratorAgents = {
  triage: async () => ({ next: 'spec', reason: 'fresh request' }),
  spec: async ({ userMessage, existingSpec }) => ({
    spec: {
      title: existingSpec
        ? `${existingSpec.title} (refined)`
        : `Feature: ${userMessage}`,
      summary: `Refined from "${userMessage}"`,
      files: ['src/a.ts', 'src/b.ts'],
    },
    ready: true,
  }),
  planner: async ({ spec }) => ({
    files: spec.files,
    rationale: 'Touch each declared file.',
  }),
  coder: async ({ filename }) => ({
    filename,
    patch: `// patched: ${filename}`,
  }),
  review: async () => ({ verdict: 'accept', notes: 'looks good' }),
}

// ============================================================
// Tests
// ============================================================

describe('example: Alem feature orchestrator ported to closure API', () => {
  it('turn 1: fresh request → triage routes to spec, run completes', async () => {
    const wf = makeOrchestrator(baseAgents)
    const events = await collect(
      runWorkflow({
        workflow: wf,
        input: { userMessage: 'Add auth' },
        runStore: inMemoryRunStore(),
      }),
    )
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: {
        phase: 'scoping',
        reason: 'spec drafted',
      },
    })
  })

  it('await-approval branch: approval triggers implementation in the same run', async () => {
    const wf = makeOrchestrator({
      ...baseAgents,
      triage: async () => ({ next: 'await-approval', reason: 'spec ready' }),
    })

    // Pretend a prior run already produced a spec.
    const seedSpec = {
      title: 'Add auth',
      summary: 'JWT-based auth',
      files: ['src/auth.ts', 'src/api.ts'],
    }

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({
        workflow: wf,
        input: {
          userMessage: 'ship it',
          previousSpec: seedSpec,
        },
        runStore: store,
      }),
    )
    const runId = findRunId(phase1)
    expect(phase1.find((e) => e.type === 'APPROVAL_REQUESTED')).toBeDefined()

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: { approvalId: 'a-1', approved: true },
        runStore: store,
      }),
    )
    const finished = phase2.find((e) => e.type === 'RUN_FINISHED')
    expect(finished).toMatchObject({
      output: {
        phase: 'implementing',
        result: {
          patches: [
            { filename: 'src/auth.ts' },
            { filename: 'src/api.ts' },
          ],
          rationale: 'Touch each declared file.',
        },
      },
    })
  })

  it('denied-with-feedback: re-routes to spec refinement, run completes in same call', async () => {
    const wf = makeOrchestrator({
      ...baseAgents,
      triage: async () => ({ next: 'await-approval', reason: 'spec ready' }),
    })

    const seedSpec = {
      title: 'Add auth',
      summary: 'JWT auth',
      files: ['src/auth.ts'],
    }
    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({
        workflow: wf,
        input: { userMessage: 'go', previousSpec: seedSpec },
        runStore: store,
      }),
    )
    const runId = findRunId(phase1)

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: {
          approvalId: 'a-1',
          approved: false,
          feedback: 'Add OAuth too',
        },
        runStore: store,
      }),
    )
    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: {
        phase: 'scoping',
        reason: 'spec refined after denial',
      },
    })
  })

  it('review branch: surfaces verdict + notes from the review agent', async () => {
    const wf = makeOrchestrator({
      ...baseAgents,
      triage: async () => ({ next: 'review', reason: 'user follow-up' }),
      review: async () => ({
        verdict: 'refine',
        notes: 'Add tests for edge cases.',
      }),
    })

    const events = await collect(
      runWorkflow({
        workflow: wf,
        input: {
          userMessage: 'looks good but tests?',
          previousSpec: {
            title: 'feature',
            summary: 's',
            files: ['x.ts'],
          },
          previousResult: {
            patches: [{ filename: 'x.ts', patch: '...' }],
            rationale: 'r',
          },
        },
        runStore: inMemoryRunStore(),
      }),
    )

    const finished = events.find((e) => e.type === 'RUN_FINISHED')
    expect(finished).toMatchObject({
      output: {
        phase: 'review',
        review: { verdict: 'refine', notes: 'Add tests for edge cases.' },
      },
    })
  })

  it('done branch: short-circuits with phase=done', async () => {
    const wf = makeOrchestrator({
      ...baseAgents,
      triage: async () => ({ next: 'done', reason: 'already finished' }),
    })
    const events = await collect(
      runWorkflow({
        workflow: wf,
        input: { userMessage: 'thanks' },
        runStore: inMemoryRunStore(),
      }),
    )
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { phase: 'done' },
    })
  })
})
