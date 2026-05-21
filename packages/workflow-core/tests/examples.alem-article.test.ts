/**
 * Port of Alem's article workflow from TanStack/ai PR #542
 * (`examples/ts-react-chat/src/lib/workflows/article-workflow.ts`).
 *
 * Original shape: 4 agents (writer, legal, skeptic, editor), state
 * machine across drafting → reviewing → editing → awaiting-approval →
 * revising → done, with a multi-round approval loop.
 *
 * In the closure API, "agents" become plain async functions that the
 * workflow calls via `ctx.step('id', fn)`. The AI calls themselves
 * are mocked here so the test runs without an LLM provider, but the
 * workflow shape is identical to production code that would swap the
 * mocks for `chat({ adapter: openaiText(...), ... })`.
 *
 * Demonstrates:
 *   - Multi-step durable workflow with branching on AI output
 *   - State mutations that flow through STATE_DELTA
 *   - Approval loop with revision rounds + denied-with-feedback path
 *   - Result helpers (succeed / fail) for tagged discriminated unions
 */
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import {
  createWorkflow,
  fail,
  inMemoryRunStore,
  runWorkflow,
  succeed,
} from '../src'
import type { WorkflowOutput } from '../src'
import { collect, findRunId } from './test-utils'

// ============================================================
// Schemas — direct ports from Alem's article-workflow.ts
// ============================================================

const Draft = z.object({
  title: z.string(),
  paragraphs: z.array(z.string()),
})

const Review = z.object({
  verdict: z.enum(['pass', 'block']),
  findings: z.array(z.string()),
})

const ArticleInput = z.object({ topic: z.string() })

const ArticleState = z.object({
  phase: z
    .enum([
      'drafting',
      'reviewing',
      'editing',
      'awaiting-approval',
      'revising',
      'done',
    ])
    .default('drafting'),
  draft: Draft.optional(),
  legalReview: Review.optional(),
  skepticReview: Review.optional(),
})

type DraftT = z.infer<typeof Draft>
type ReviewT = z.infer<typeof Review>

// ============================================================
// "Agent" implementations — plain async functions. In production
// these would call `chat({ adapter: openaiText(...), ... })`. The
// workflow doesn't care how they're implemented as long as they
// return data matching the declared types.
// ============================================================

interface AgentImpls {
  writer: (args: { topic: string }) => Promise<DraftT>
  legalReview: (args: { draft: DraftT }) => Promise<ReviewT>
  skepticReview: (args: { draft: DraftT }) => Promise<ReviewT>
  editor: (args: { draft: DraftT; notes: Array<string> }) => Promise<DraftT>
}

function makeArticleWorkflow(agents: AgentImpls) {
  return createWorkflow({
    id: 'article-workflow',
    input: ArticleInput,
    state: ArticleState,
  }).handler(async (ctx) => {
    ctx.state.phase = 'drafting'
    const draft = await ctx.step('writer', () =>
      agents.writer({ topic: ctx.input.topic }),
    )
    ctx.state.draft = draft

    ctx.state.phase = 'reviewing'
    const legal = await ctx.step('legal', () => agents.legalReview({ draft }))
    ctx.state.legalReview = legal
    if (legal.verdict === 'block') {
      return fail(`legal: ${legal.findings.join('; ')}`)
    }

    const skeptic = await ctx.step('skeptic', () =>
      agents.skepticReview({ draft }),
    )
    ctx.state.skepticReview = skeptic
    if (skeptic.verdict === 'block') {
      return fail(`skeptic: ${skeptic.findings.join('; ')}`)
    }

    ctx.state.phase = 'editing'
    let current = await ctx.step('editor-initial', () =>
      agents.editor({
        draft,
        notes: [...legal.findings, ...skeptic.findings],
      }),
    )
    ctx.state.draft = current

    for (let round = 0; round < 4; round++) {
      ctx.state.phase = 'awaiting-approval'
      const decision = await ctx.approve({
        title:
          round === 0 ? 'Publish this article?' : 'Publish the revision?',
        description: current.title,
      })
      if (decision.approved) {
        ctx.state.phase = 'done'
        return succeed({ article: current })
      }
      if (!decision.feedback || !decision.feedback.trim()) {
        ctx.state.phase = 'done'
        return fail('user denied')
      }
      ctx.state.phase = 'revising'
      current = await ctx.step(`editor-revise-${round}`, () =>
        agents.editor({
          draft: current,
          notes: [decision.feedback!],
        }),
      )
      ctx.state.draft = current
    }
    return fail('too many revision rounds')
  })
}

// ============================================================
// Deterministic mocks for the tests
// ============================================================

const happyAgents: AgentImpls = {
  writer: ({ topic }) =>
    Promise.resolve({
      title: `Why ${topic} matters`,
      paragraphs: ['A.', 'B.', 'C.'],
    }),
  legalReview: () =>
    Promise.resolve({ verdict: 'pass', findings: [] }),
  skepticReview: () =>
    Promise.resolve({ verdict: 'pass', findings: [] }),
  editor: ({ draft }) =>
    Promise.resolve({
      title: `${draft.title} (edited)`,
      paragraphs: draft.paragraphs.map((p) => `${p} (polished)`),
    }),
}

// ============================================================
// Tests
// ============================================================

describe('example: Alem article workflow ported to closure API', () => {
  it('happy path: writer → reviews pass → editor → approve → publishes', async () => {
    const wf = makeArticleWorkflow(happyAgents)
    const store = inMemoryRunStore()

    // Start — runs writer + reviewers + editor, pauses on approve
    const phase1 = await collect(
      runWorkflow({
        workflow: wf,
        input: { topic: 'durable execution' },
        runStore: store,
      }),
    )
    const runId = findRunId(phase1)
    expect(phase1.find((e) => e.type === 'APPROVAL_REQUESTED')).toBeDefined()

    // Resume — approve, run finishes
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
        ok: true,
        article: {
          title: 'Why durable execution matters (edited)',
        },
      },
    })
  })

  it('legal block: workflow short-circuits with fail()', async () => {
    const wf = makeArticleWorkflow({
      ...happyAgents,
      legalReview: () =>
        Promise.resolve({
          verdict: 'block',
          findings: ['Disclaimer missing'],
        }),
    })

    const events = await collect(
      runWorkflow({
        workflow: wf,
        input: { topic: 'unregulated claims' },
        runStore: inMemoryRunStore(),
      }),
    )

    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { ok: false, reason: 'legal: Disclaimer missing' },
    })
  })

  it('revision round: denial with feedback re-runs editor, then approval succeeds', async () => {
    const wf = makeArticleWorkflow(happyAgents)
    const store = inMemoryRunStore()

    const phase1 = await collect(
      runWorkflow({
        workflow: wf,
        input: { topic: 'workflows' },
        runStore: store,
      }),
    )
    const runId = findRunId(phase1)

    // First decision: deny with feedback → triggers a revision round.
    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: {
          approvalId: 'a-1',
          approved: false,
          feedback: 'Make it punchier',
        },
        runStore: store,
      }),
    )
    // After the revision, another approval is requested.
    expect(phase2.find((e) => e.type === 'APPROVAL_REQUESTED')).toBeDefined()
    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toBeUndefined()

    // Approve the revision
    const phase3 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: { approvalId: 'a-2', approved: true },
        runStore: store,
      }),
    )
    expect(phase3.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { ok: true },
    })
  })

  it('preserves end-to-end type inference on the workflow output', () => {
    const wf = makeArticleWorkflow(happyAgents)
    // Output is the discriminated union of succeed / fail, with the
    // narrower `article` shape preserved through `succeed`.
    expectTypeOf<WorkflowOutput<typeof wf>>().toMatchTypeOf<
      | { ok: true; article: DraftT }
      | { ok: false; reason: string }
    >()
  })
})
