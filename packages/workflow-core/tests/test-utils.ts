import type { WorkflowEvent } from '../src/types'
import type { InMemoryRunStore } from '../src/run-store/in-memory'

/** Drain an async iterable into an array. */
export async function collect<T>(iter: AsyncIterable<T>): Promise<Array<T>> {
  const out: Array<T> = []
  for await (const c of iter) out.push(c)
  return out
}

/**
 * Pull the runId off the RUN_STARTED event a workflow emits. Throws
 * if the stream didn't start a run — which always indicates a bug in
 * the calling test.
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
 * Simulate a process restart. In the closure engine every resume is
 * already a fresh replay from the persisted log — there's no in-
 * memory live-handle to invalidate — so this is a no-op kept for
 * test-narrative clarity. (Older designs needed to flush a generator
 * cache here.)
 */
export function simulateRestart(_store: InMemoryRunStore): void {
  // intentionally empty
}
