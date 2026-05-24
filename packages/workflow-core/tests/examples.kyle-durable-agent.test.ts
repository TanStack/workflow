/**
 * Port of Kyle Mathews's `createDurableAgent` pattern from his
 * tanstack-agent.ts gist
 * (https://gist.github.com/KyleAMathews/cea66bd26bda9a0faa08b39fdd7034ce).
 *
 * Kyle's gist shows a higher-level "durable agent" abstraction with:
 *   - declared `tools` (name, description, schema, handler)
 *   - `permissions: { allow, requireApproval }` per-tool gating
 *   - a virtual filesystem the agent reads/writes for context/memory
 *   - a session URL the client tails
 *
 * The agent abstraction itself isn't a workflow-core primitive — it
 * lives one layer up in `@tanstack/ai-orchestration` (or any UX-
 * focused agent SDK). This test demonstrates that the *runtime
 * shape* of a durable agent can be expressed cleanly as a
 * workflow-core workflow:
 *
 *   - tools         → plain async functions invoked via `ctx.step`
 *   - permissions   → branch on tool name, gate with `ctx.approve`
 *   - virtual FS    → state object whose paths are object keys
 *   - agent loop    → a while loop that asks the LLM for the next
 *                     tool call and dispatches it
 *
 * The LLM "decide next tool" reasoning is stubbed with a fixed
 * sequence so the test runs deterministically.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import { collect, findApprovalId, findRunId } from './test-utils'

// ============================================================
// Tool definitions — what the agent can do
// ============================================================

interface ToolHandlers {
  lookupManager: (args: {
    employeeId: string
    amount: number
  }) => Promise<{ managerId: string; name: string; email: string }>
  recordToLedger: (args: {
    expenseId: string
    approvedBy: string
  }) => Promise<{ ledgerEntryId: string }>
  sendNotification: (args: {
    userId: string
    message: string
  }) => Promise<{ sent: true; channel: string }>
}

const TOOL_PERMISSIONS = {
  allow: new Set<keyof ToolHandlers>(['lookupManager']),
  requireApproval: new Set<keyof ToolHandlers>([
    'recordToLedger',
    'sendNotification',
  ]),
} as const

type ToolCall =
  | { tool: 'lookupManager'; args: { employeeId: string; amount: number } }
  | { tool: 'recordToLedger'; args: { expenseId: string; approvedBy: string } }
  | {
      tool: 'sendNotification'
      args: { userId: string; message: string }
    }
  | { tool: 'done'; outcome: string }

// ============================================================
// Virtual FS — a plain object addressed by path
// ============================================================

const VirtualFs = z.object({
  context: z
    .record(z.string(), z.string())
    .default(() => ({}) as Record<string, string>),
  memory: z
    .record(z.string(), z.string())
    .default(() => ({}) as Record<string, string>),
})

// ============================================================
// The durable agent workflow
// ============================================================

interface AgentDecider {
  /** Stand-in for the LLM. Decides the next tool call given the
   *  current state of the virtual FS + the prior tool's result. */
  nextAction: (args: {
    fs: { context: Record<string, string>; memory: Record<string, string> }
    lastResult: unknown
  }) => Promise<ToolCall>
}

function makeDurableAgent(
  tools: ToolHandlers,
  decider: AgentDecider,
  maxIterations = 16,
) {
  return createWorkflow({
    id: 'durable-agent',
    input: z.object({
      goal: z.string(),
      seedContext: z.record(z.string(), z.string()).default({}),
    }),
    state: VirtualFs,
  }).handler(async (ctx) => {
    // Seed the virtual FS from the input.
    ctx.state.context = { ...ctx.input.seedContext, 'goal.md': ctx.input.goal }
    ctx.state.memory['progress.md'] = 'starting'

    let lastResult: unknown = undefined
    const callsMade: Array<{
      tool: string
      args: unknown
      result?: unknown
      approved?: boolean
    }> = []

    for (let i = 0; i < maxIterations; i++) {
      // 1. Ask the LLM what to do next.
      const action = await ctx.step(`decide-${i}`, () =>
        decider.nextAction({
          fs: { context: ctx.state.context, memory: ctx.state.memory },
          lastResult,
        }),
      )

      if (action.tool === 'done') {
        ctx.state.memory['progress.md'] = `done: ${action.outcome}`
        return {
          status: 'completed' as const,
          outcome: action.outcome,
          callsMade,
        }
      }

      // 2. Permission check.
      if (TOOL_PERMISSIONS.requireApproval.has(action.tool)) {
        const decision = await ctx.approve({
          title: `Run "${action.tool}"?`,
          description: `args: ${JSON.stringify(action.args)}`,
        })
        if (!decision.approved) {
          callsMade.push({
            tool: action.tool,
            args: action.args,
            approved: false,
          })
          // Record the denial in the virtual FS so the next decide step
          // can react.
          ctx.state.memory[`denied-${i}.md`] = action.tool
          lastResult = { denied: true, reason: decision.feedback }
          continue
        }
      } else if (!TOOL_PERMISSIONS.allow.has(action.tool)) {
        throw new Error(`Tool "${action.tool}" is not in any permission list`)
      }

      // 3. Run the tool durably. Use an explicit `unknown` return so
      // the function's inferred type unifies across the switch arms;
      // each branch's `Promise<X>` would otherwise stay a distinct
      // union member and conflict with `ctx.step`'s `T | Promise<T>`
      // signature.
      const result = await ctx.step<unknown>(`tool-${action.tool}-${i}`, () => {
        switch (action.tool) {
          case 'lookupManager':
            return tools.lookupManager(action.args)
          case 'recordToLedger':
            return tools.recordToLedger(action.args)
          case 'sendNotification':
            return tools.sendNotification(action.args)
        }
      })

      callsMade.push({
        tool: action.tool,
        args: action.args,
        result,
        approved: true,
      })
      ctx.state.memory[`step-${i}.md`] = `${action.tool} → ok`
      lastResult = result
    }

    return {
      status: 'exhausted' as const,
      reason: 'max iterations',
      callsMade,
    }
  })
}

// ============================================================
// Stubs
// ============================================================

const stubTools: ToolHandlers = {
  lookupManager: async ({ employeeId, amount }) => ({
    managerId: `mgr-${employeeId}-${amount}`,
    name: 'Manager',
    email: 'manager@example.com',
  }),
  recordToLedger: async ({ expenseId, approvedBy }) => ({
    ledgerEntryId: `ledger-${expenseId}-${approvedBy}`,
  }),
  sendNotification: async () => ({ sent: true, channel: 'email' }),
}

/** A deterministic scripted decider — drives the agent through a
 *  three-tool sequence then declares done. */
function scriptedDecider(script: Array<ToolCall>): AgentDecider {
  let i = 0
  return {
    nextAction: async () => {
      if (i >= script.length) return { tool: 'done', outcome: 'no more steps' }
      return script[i++]!
    },
  }
}

// ============================================================
// Tests
// ============================================================

describe('example: Kyle durable-agent pattern on top of workflow-core', () => {
  it('runs an allow-listed tool with no approval needed', async () => {
    const wf = makeDurableAgent(
      stubTools,
      scriptedDecider([
        {
          tool: 'lookupManager',
          args: { employeeId: 'e-1', amount: 250 },
        },
        { tool: 'done', outcome: 'lookup complete' },
      ]),
    )

    const events = await collect(
      runWorkflow({
        workflow: wf,
        input: { goal: 'find the right approver', seedContext: {} },
        runStore: inMemoryRunStore(),
      }),
    )
    expect(events.find((e) => e.type === 'APPROVAL_REQUESTED')).toBeUndefined()
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: {
        status: 'completed',
        outcome: 'lookup complete',
        callsMade: [
          {
            tool: 'lookupManager',
            result: { managerId: 'mgr-e-1-250' },
            approved: true,
          },
        ],
      },
    })
  })

  it('approval-required tool: pauses on approve, runs after approval', async () => {
    const wf = makeDurableAgent(
      stubTools,
      scriptedDecider([
        {
          tool: 'recordToLedger',
          args: { expenseId: 'exp-1', approvedBy: 'alice' },
        },
        { tool: 'done', outcome: 'recorded' },
      ]),
    )

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({
        workflow: wf,
        input: { goal: 'post expense', seedContext: {} },
        runStore: store,
      }),
    )
    const runId = findRunId(phase1)
    expect(phase1.find((e) => e.type === 'APPROVAL_REQUESTED')).toMatchObject({
      title: 'Run "recordToLedger"?',
    })

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: { approvalId: findApprovalId(phase1), approved: true },
        runStore: store,
      }),
    )
    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: {
        status: 'completed',
        outcome: 'recorded',
        callsMade: [
          {
            tool: 'recordToLedger',
            result: { ledgerEntryId: 'ledger-exp-1-alice' },
            approved: true,
          },
        ],
      },
    })
  })

  it('denied approval: tool is skipped, agent records the denial and continues', async () => {
    const wf = makeDurableAgent(
      stubTools,
      scriptedDecider([
        {
          tool: 'sendNotification',
          args: { userId: 'u-1', message: 'unauthorized blast' },
        },
        { tool: 'done', outcome: 'finished without sending' },
      ]),
    )

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({
        workflow: wf,
        input: { goal: 'maybe notify', seedContext: {} },
        runStore: store,
      }),
    )
    const runId = findRunId(phase1)

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: {
          approvalId: findApprovalId(phase1),
          approved: false,
          feedback: 'do not send',
        },
        runStore: store,
      }),
    )
    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: {
        status: 'completed',
        outcome: 'finished without sending',
        callsMade: [
          {
            tool: 'sendNotification',
            approved: false,
            // No `result` field — tool wasn't run.
          },
        ],
      },
    })
  })

  it('the virtual FS surfaces in STATE_DELTA events as the agent runs', async () => {
    const wf = makeDurableAgent(
      stubTools,
      scriptedDecider([
        {
          tool: 'lookupManager',
          args: { employeeId: 'e-1', amount: 100 },
        },
        { tool: 'done', outcome: 'found' },
      ]),
    )

    const events = await collect(
      runWorkflow({
        workflow: wf,
        input: { goal: 'find manager', seedContext: { 'hint.md': 'try mgr' } },
        runStore: inMemoryRunStore(),
      }),
    )

    // Initial state seeded from input.
    const hasGoalDelta = events.some(
      (e) =>
        e.type === 'STATE_DELTA' &&
        e.delta.some((op) => 'path' in op && op.path === '/context/goal.md'),
    )
    expect(hasGoalDelta).toBe(true)

    // Memory updated with progress + per-step markers.
    const memoryUpdates = events.filter(
      (e) =>
        e.type === 'STATE_DELTA' &&
        e.delta.some((op) => 'path' in op && op.path.startsWith('/memory/')),
    )
    expect(memoryUpdates.length).toBeGreaterThan(0)
  })
})
