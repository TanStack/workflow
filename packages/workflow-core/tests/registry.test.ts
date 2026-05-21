import { describe, expect, it } from 'vitest'
import {
  createWorkflow,
  createWorkflowRegistry,
  inMemoryRunStore,
  runWorkflow,
  selectWorkflowVersion,
} from '../src'
import { collect, findRunId, simulateRestart } from './test-utils'

describe('selectWorkflowVersion', () => {
  it('returns the version matching the run`s persisted workflowVersion', async () => {
    const v1 = createWorkflow({ id: 'pipeline', version: 'v1' }).handler(
      async (ctx) => {
        await ctx.approve({ title: 'go?' })
        return {}
      },
    )
    const v2 = createWorkflow({ id: 'pipeline', version: 'v2' }).handler(
      async (ctx) => {
        await ctx.approve({ title: 'go?' })
        return {}
      },
    )

    const store = inMemoryRunStore()
    const events = await collect(
      runWorkflow({ workflow: v1, input: {}, runStore: store }),
    )
    const runId = findRunId(events)

    const matched = await selectWorkflowVersion([v1, v2], runId, store)
    expect(matched?.version).toBe('v1')
  })

  it('returns undefined when no version matches', async () => {
    const v1 = createWorkflow({ id: 'pipeline', version: 'v1' }).handler(
      async (ctx) => {
        await ctx.approve({ title: 'go?' })
        return {}
      },
    )

    const store = inMemoryRunStore()
    const events = await collect(
      runWorkflow({ workflow: v1, input: {}, runStore: store }),
    )
    const runId = findRunId(events)

    expect(await selectWorkflowVersion([], runId, store)).toBeUndefined()
  })

  it('does NOT fall through to an unversioned definition for a versioned run', async () => {
    const v1 = createWorkflow({ id: 'pipeline', version: 'v1' }).handler(
      async (ctx) => {
        await ctx.approve({ title: 'go?' })
        return {}
      },
    )
    const legacy = createWorkflow({ id: 'pipeline' }).handler(async (ctx) => {
      await ctx.approve({ title: 'go?' })
      return {}
    })

    const store = inMemoryRunStore()
    const events = await collect(
      runWorkflow({ workflow: v1, input: {}, runStore: store }),
    )
    const runId = findRunId(events)

    expect(
      await selectWorkflowVersion([legacy], runId, store),
    ).toBeUndefined()
  })
})

describe('createWorkflowRegistry', () => {
  const makeWf = (version: string) =>
    createWorkflow({ id: 'pipeline', version }).handler(async (ctx) => {
      await ctx.approve({ title: 'go?' })
      return {}
    })

  it('rejects duplicate (id, version) pairs', () => {
    const reg = createWorkflowRegistry()
    reg.add(makeWf('v1'))
    expect(() => reg.add(makeWf('v1'))).toThrow(/already registered/)
  })

  it('end-to-end: run started under v1 routes back through the registry to v1', async () => {
    const v1 = makeWf('v1')
    const v2 = makeWf('v2')
    const reg = createWorkflowRegistry({ default: v2 })
    reg.add(v1)
    reg.add(v2)

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: v1, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)

    simulateRestart(store)

    const routed = await reg.forRun(runId, store)
    expect(routed?.version).toBe('v1')
  })

  it('returns `default` when no specific version matches', async () => {
    const v1 = makeWf('v1')
    const v3 = makeWf('v3')

    const store = inMemoryRunStore()
    const phase1 = await collect(
      runWorkflow({ workflow: v1, input: {}, runStore: store }),
    )
    const runId = findRunId(phase1)

    const regWithoutV1 = createWorkflowRegistry({ default: v3 })
    regWithoutV1.add(v3)

    expect((await regWithoutV1.forRun(runId, store))?.version).toBe('v3')
  })
})
