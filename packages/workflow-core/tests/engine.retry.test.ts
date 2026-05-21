import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createWorkflow, inMemoryRunStore, runWorkflow } from '../src'
import { collect } from './test-utils'

describe('ctx.step() retry policy', () => {
  it('retries up to maxAttempts then succeeds', async () => {
    let attempts = 0
    const wf = createWorkflow({
      id: 'retry-succeeds',
      output: z.object({ value: z.number() }),
    }).handler(async (ctx) => {
      const v = await ctx.step(
        'flaky',
        () => {
          attempts++
          if (attempts < 3) throw new Error(`flake-${attempts}`)
          return 42
        },
        { retry: { maxAttempts: 3, backoff: 'fixed', baseMs: 1 } },
      )
      return { value: v }
    })

    const store = inMemoryRunStore()
    const events = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )
    expect(attempts).toBe(3)
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { value: 42 },
    })

    // Run finished → store cleaned up. Inspect via the streamed events.
    const finished = events.find((e) => e.type === 'STEP_FINISHED')
    expect(finished).toMatchObject({ stepId: 'flaky' })
    expect(
      (finished as Extract<typeof events[number], { type: 'STEP_FINISHED' }>)
        .attempts,
    ).toHaveLength(3)
  })

  it('emits STEP_FAILED after maxAttempts exhausted', async () => {
    let attempts = 0
    const wf = createWorkflow({
      id: 'retry-exhausts',
      output: z.object({ caught: z.boolean() }),
    }).handler(async (ctx) => {
      let caught = false
      try {
        await ctx.step(
          'always-fails',
          () => {
            attempts++
            throw new Error('nope')
          },
          { retry: { maxAttempts: 2, backoff: 'fixed', baseMs: 1 } },
        )
      } catch {
        caught = true
      }
      return { caught }
    })

    const store = inMemoryRunStore()
    const events = await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: store }),
    )

    expect(attempts).toBe(2)
    expect(events.find((e) => e.type === 'STEP_FAILED')).toMatchObject({
      stepId: 'always-fails',
      error: { message: 'nope' },
    })
    expect(events.find((e) => e.type === 'RUN_FINISHED')).toMatchObject({
      output: { caught: true },
    })
  })

  it('honors shouldRetry — false stops retries early', async () => {
    let attempts = 0
    const wf = createWorkflow({
      id: 'should-retry',
      output: z.object({ caught: z.boolean() }),
    }).handler(async (ctx) => {
      let caught = false
      try {
        await ctx.step(
          'maybe',
          () => {
            attempts++
            throw new Error(`attempt-${attempts}`)
          },
          {
            retry: {
              maxAttempts: 5,
              backoff: 'fixed',
              baseMs: 1,
              shouldRetry: (err) =>
                err instanceof Error && err.message !== 'attempt-2',
            },
          },
        )
      } catch {
        caught = true
      }
      return { caught }
    })

    await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )

    // shouldRetry returned false on the second attempt → bail.
    expect(attempts).toBe(2)
  })

  it('applies workflow-level defaultStepRetry when step has no policy', async () => {
    let attempts = 0
    const wf = createWorkflow({
      id: 'default-retry',
      output: z.object({ ok: z.boolean() }),
    })
      .handler(async (ctx) => {
        await ctx.step('flake', () => {
          attempts++
          if (attempts < 2) throw new Error('x')
          return null
        })
        return { ok: true }
      })

    // Apply default retry by overriding on the definition object.
    wf.defaultStepRetry = { maxAttempts: 3, backoff: 'fixed', baseMs: 1 }

    await collect(
      runWorkflow({ workflow: wf, input: {}, runStore: inMemoryRunStore() }),
    )
    expect(attempts).toBe(2)
  })
})
