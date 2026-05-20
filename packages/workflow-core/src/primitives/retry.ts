import type { StepDescriptor } from '../types'

export interface RetryOptions {
  attempts: number
  backoff?: 'none' | 'linear' | 'exponential'
  /** Base delay in ms. Default 100. */
  baseDelayMs?: number
  /** Max delay in ms. Default 5000. */
  maxDelayMs?: number
  /** Predicate — return true to retry on this error. Default: retry any. */
  retryOn?: (err: unknown, attempt: number) => boolean
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeDelay(opts: RetryOptions, attempt: number): number {
  const base = opts.baseDelayMs ?? 100
  const max = opts.maxDelayMs ?? 5000
  switch (opts.backoff ?? 'none') {
    case 'none':
      return 0
    case 'linear':
      return Math.min(base * attempt, max)
    case 'exponential':
      return Math.min(base * 2 ** (attempt - 1), max)
  }
}

/**
 * Retry a yield-producing step on failure.
 *
 *     const data = yield* retry(
 *       () => step('fetch', () => fetchData()),
 *       { attempts: 3, backoff: 'exponential' },
 *     )
 *
 * Each attempt invokes `fn()` fresh, so the underlying generator
 * restarts. Returns an async generator to support delay between
 * retries.
 *
 * Note: `step({ retry })` is preferred when retrying a single step —
 * the engine's built-in retry has access to attempt records and the
 * step's idempotency context. Use this primitive when you need to
 * retry a *composite* of multiple yields as a unit.
 */
export async function* retry<T>(
  // TNext is `any` (not `T`) to match `StepGenerator<T>` — the engine sends
  // step results of unrelated types back into the user generator at each
  // yield boundary, and constraining TNext to T would reject legitimate
  // workflows that yield multiple step calls with differing return
  // types inside the retried block.
  fn: () => Generator<StepDescriptor, T, any>,
  options: RetryOptions,
): AsyncGenerator<StepDescriptor, T, any> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return yield* fn()
    } catch (err) {
      lastErr = err
      if (options.retryOn && !options.retryOn(err, attempt)) {
        throw err
      }
      if (attempt === options.attempts) break
      const ms = computeDelay(options, attempt)
      if (ms > 0) await delay(ms)
    }
  }
  throw lastErr
}
