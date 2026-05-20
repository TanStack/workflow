/**
 * Shared helpers for the engine test suite. Keep this lean — only add
 * functions that genuinely appear in multiple files. Test-specific
 * scaffolding (step factories, workflow shapes used by a single spec)
 * stays in the test file that owns it.
 */

import type { WorkflowEvent } from '../src/types'
import type { InMemoryRunStore } from '../src/run-store/in-memory'

/** Drain an async iterable into an array. */
export async function collect<T>(iter: AsyncIterable<T>): Promise<Array<T>> {
  const out: Array<T> = []
  for await (const c of iter) out.push(c)
  return out
}

/**
 * Pull the runId off the RUN_STARTED event a workflow emits. Throws if
 * the stream didn't start a run — which always indicates a bug in the
 * calling test, not a recoverable condition.
 */
export function findRunId(events: ReadonlyArray<WorkflowEvent>): string {
  const started = events.find(
    (e): e is Extract<WorkflowEvent, { type: 'RUN_STARTED' }> =>
      e.type === 'RUN_STARTED',
  )
  if (!started) {
    throw new Error('findRunId: no RUN_STARTED event in stream')
  }
  return started.runId
}

/**
 * Drop the in-memory store's live generator handle so the engine takes
 * the replay-from-log path on the next resume. Simulates a process
 * restart (in production durable stores can't surface the live
 * generator anyway — this is the same path real deployments hit).
 */
export function simulateRestart(store: InMemoryRunStore): void {
  store.getLive = () => undefined
}
