/**
 * Replay-from-log correctness across a simulated process restart.
 * Pins:
 *   - Step fns are NOT re-executed on replay; the recorded result is
 *     delivered instead.
 *   - State reconstructs deterministically from `initialize` +
 *     user-code mutations re-run through replay.
 *   - workflow_version_mismatch is raised when the persisted version
 *     doesn't match the current workflow's version and no
 *     previousVersions entry covers it.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import {
  collect,
  findApprovalId,
  findRunId,
  simulateRestart,
} from './test-utils'

describe('engine durability', () => {
  it('does not re-execute step fns on replay', async () => {
    let aCount = 0
    let bCount = 0
    const wf = createWorkflow({ id: 'no-reexec' }).handler(async (ctx) => {
      const a = await ctx.step('a', () => {
        aCount++
        return 1
      })
      const b = await ctx.step('b', () => {
        bCount++
        return 2
      })
      await ctx.approve({ title: 'go?' })
      return { a, b }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)
    expect(aCount).toBe(1)
    expect(bCount).toBe(1)

    simulateRestart(store)

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: { approvalId: findApprovalId(phase1), approved: true },
        runStore: store,
      }),
    )

    // Replay must short-circuit both step yields without re-invoking
    // either fn.
    expect(aCount).toBe(1)
    expect(bCount).toBe(1)
    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { a: 1, b: 2 },
    })
  })

  it('reconstructs state from initialize + handler mutations through replay', async () => {
    const wf = createWorkflow({
      id: 'state-replay',
      input: z.object({ seed: z.number() }),
      state: z.object({ counter: z.number().default(0) }),
      initialize: ({ input }) => ({ counter: input.seed }),
    }).handler(async (ctx) => {
      ctx.state.counter += 10
      const bump = await ctx.step('bump', () => 5)
      ctx.state.counter += bump
      await ctx.approve({ title: 'go?' })
      return { final: ctx.state.counter }
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({
        workflow: wf,
        input: { seed: 100 },
        runStore: store,
      }),
    )
    const runId = findRunId(phase1)

    simulateRestart(store)

    const phase2 = await collect(
      runWorkflow({
        workflow: wf,
        runId,
        approval: { approvalId: findApprovalId(phase1), approved: true },
        runStore: store,
      }),
    )

    // After replay reconstructs state, the final returned value
    // reflects the same arithmetic (100 + 10 + 5 = 115).
    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { final: 115 },
    })
  })

  it('refuses resume when the workflow version drifts (no previousVersions)', async () => {
    const v1 = createWorkflow({
      id: 'drifting',
      version: 'v1',
    }).handler(async (ctx) => {
      await ctx.step('a', () => 1)
      await ctx.approve({ title: 'go?' })
      return {}
    })

    const v2 = createWorkflow({
      id: 'drifting',
      version: 'v2',
    }).handler(async (ctx) => {
      await ctx.step('a-renamed', () => 1)
      await ctx.approve({ title: 'go?' })
      return {}
    })

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: v1, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)

    simulateRestart(store)

    const phase2 = await collect(
      runWorkflow({
        workflow: v2,
        runId,
        approval: { approvalId: findApprovalId(phase1), approved: true },
        runStore: store,
      }),
    )

    expect(phase2.find((e) => e.type === 'RUN_ERRORED')).toMatchObject({
      code: 'workflow_version_mismatch',
    })
  })

  it('routes a versioned run to its matching previousVersions entry', async () => {
    const v1 = createWorkflow({
      id: 'migrating',
      version: 'v1',
      output: z.object({ source: z.string() }),
    }).handler(async (ctx) => {
      await ctx.approve({ title: 'go?' })
      return { source: 'v1' }
    })

    const v2 = createWorkflow({
      id: 'migrating',
      version: 'v2',
      output: z.object({ source: z.string() }),
    })
      .previousVersions([v1])
      .handler(async (ctx) => {
        await ctx.approve({ title: 'go?' })
        return { source: 'v2' }
      })

    const store = inMemoryRunStore()
    // Start under v1.
    const phase1 = await collect(
      runWorkflow({ workflow: v1, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)

    simulateRestart(store)

    // Resume by handing the engine the CURRENT workflow (v2). v2's
    // `previousVersions` includes v1, so the engine should route the
    // resume to v1's handler.
    const phase2 = await collect(
      runWorkflow({
        workflow: v2,
        runId,
        approval: { approvalId: findApprovalId(phase1), approved: true },
        runStore: store,
      }),
    )

    expect(phase2.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { source: 'v1' },
    })
  })
})
