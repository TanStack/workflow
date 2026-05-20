import type { StepDescriptor, StepGenerator } from '../types'

export interface WaitForSignalOptions {
  /** UTC ms wake deadline. Surfaced on `RunState.waitingFor.deadline`
   *  so hosts can build time-indexed worker jobs (cron, scheduled
   *  queues) that wake the run when the deadline arrives. Past-
   *  deadline waits resolve immediately when the host eventually
   *  delivers — no special "skipped sleep" semantics. */
  deadline?: number
  /** Free-form metadata the host or UI may render. Opaque to the
   *  engine. Useful for typed signal wrappers. */
  meta?: Record<string, unknown>
}

/**
 * Yieldable durable pause.
 *
 *     const payload = yield* waitForSignal<{ ok: boolean }>('webhook-received')
 *
 * Engine semantics:
 *
 *  1. The yield pauses the run. The engine persists state with a
 *     `waitingFor: { signalName, deadline?, meta? }` record so an
 *     independent worker can discover the pending wake by polling the
 *     store (the "pull" discovery channel).
 *  2. The engine emits a `run.paused` custom event on the event
 *     stream describing the pause (the "push" discovery channel) so
 *     the originating request handler can register a wakeup callback
 *     in its own scheduler.
 *  3. The event stream closes.
 *  4. The host resumes the run by calling
 *     `runWorkflow({ runId, signalDelivery: { signalId, payload } })`.
 *     The payload becomes the value of `yield* waitForSignal()`.
 *
 * Sleep is built on this with the reserved signal name `'__timer'` and
 * a deadline; engine-injected wakes for the timer signal carry an
 * empty payload (sleep returns `undefined` to user code).
 */
export function* waitForSignal<TPayload = unknown>(
  name: string,
  options?: WaitForSignalOptions,
): StepGenerator<TPayload> {
  const descriptor: StepDescriptor = {
    kind: 'signal',
    name,
    deadline: options?.deadline,
    meta: options?.meta,
  }
   
  return yield descriptor
}
