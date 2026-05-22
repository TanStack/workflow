/**
 * Port of Alem's `engine.publisher.test.ts`. The publisher hook lets
 * the host fan engine events out to subscribers on other nodes
 * (Redis pub/sub, NATS, EventBridge, Durable Streams). Library
 * contract:
 *   - every event the engine yields is passed to `publish` before
 *     reaching the AsyncIterable consumer
 *   - all events carry a stable runId
 *   - errors thrown by `publish` are swallowed and never break the run
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import type { WorkflowEvent } from '../src'
import { collect } from './test-utils'

async function drain(iter: AsyncIterable<WorkflowEvent>): Promise<void> {
  for await (const _ of iter) {
    /* drain — publisher hook is the observed side-effect */
  }
}

describe('publisher hook', () => {
  it('receives every event the engine yields, with a stable runId', async () => {
    const wf = createWorkflow({
      id: 'publish-wf',
      input: z.object({ msg: z.string() }),
    }).handler(async (ctx) => {
      await ctx.step('echo', () => ctx.input.msg.toUpperCase())
      return {}
    })

    const seen: Array<{ runId: string; type: string }> = []
    await drain(
      runWorkflow({
        workflow: wf,
        input: { msg: 'hi' },
        runStore: inMemoryRunStore(),
        publish: (runId, event) => {
          seen.push({ runId, type: event.type })
        },
      }),
    )

    const types = seen.map((s) => s.type)
    expect(types).toContain('RUN_STARTED')
    expect(types).toContain('STEP_STARTED')
    expect(types).toContain('STEP_FINISHED')
    expect(types).toContain('RUN_FINISHED')

    const runIds = new Set(seen.map((s) => s.runId))
    expect(runIds.size).toBe(1)
    const onlyRunId = [...runIds][0]!
    expect(onlyRunId).toMatch(/^run_/)
  })

  it('swallows publisher errors so the run still completes', async () => {
    const wf = createWorkflow({
      id: 'publish-throws',
    }).handler(async () => ({ ok: true }))

    const events = await collect(
      runWorkflow({
        workflow: wf,
        input: {},
        runStore: inMemoryRunStore(),
        publish: () => {
          throw new Error('publisher offline')
        },
      }),
    )

    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { ok: true },
    })
  })

  it('forwards SIGNAL_AWAITED so an out-of-process subscriber can register a wake', async () => {
    const wf = createWorkflow({ id: 'publish-pause' }).handler(async (ctx) => {
      await ctx.waitForEvent('webhook')
      return {}
    })

    const customEvents: Array<{
      type: string
      name?: string
      payload?: unknown
    }> = []
    await drain(
      runWorkflow({
        workflow: wf,
        input: {},
        runStore: inMemoryRunStore(),
        publish: (_runId, event) => {
          if (event.type === 'SIGNAL_AWAITED') {
            customEvents.push({ type: event.type, name: event.name })
          }
        },
      }),
    )

    expect(customEvents).toEqual([{ type: 'SIGNAL_AWAITED', name: 'webhook' }])
  })
})
