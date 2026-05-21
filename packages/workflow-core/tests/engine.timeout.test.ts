import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import { collect } from './test-utils'

describe('ctx.step() timeout', () => {
  it('surfaces StepTimeoutError when the fn ignores its abort signal', async () => {
    const wf = createWorkflow({
      id: 'timeout-hang',
      output: z.object({ message: z.string() }),
    }).handler(async (ctx) => {
      let message = 'unset'
      try {
        await ctx.step(
          'hang',
          () =>
            new Promise<void>(() => {
              /* never resolves */
            }),
          { timeout: 20 },
        )
      } catch (err) {
        message = err instanceof Error ? err.message : String(err)
      }
      return { message }
    })

    const events = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )
    const finished = events.find((e) => e.type === 'RUN_FINISHED')
    expect(finished).toMatchObject({
      output: { message: expect.stringMatching(/exceeded 20ms timeout/) },
    })
  })

  it('retries on timeout up to maxAttempts', async () => {
    let attempts = 0
    const wf = createWorkflow({
      id: 'timeout-retry',
      output: z.object({ value: z.number() }),
    }).handler(async (ctx) => {
      const value = await ctx.step(
        'slow-then-fast',
        async (stepCtx) => {
          attempts++
          if (stepCtx.attempt < 3) {
            await new Promise((r) => setTimeout(r, 50))
          }
          return 42
        },
        {
          timeout: 10,
          retry: { maxAttempts: 3, backoff: 'fixed', baseMs: 1 },
        },
      )
      return { value }
    })

    const events = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )
    expect(attempts).toBe(3)
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { value: 42 },
    })
  })
})
