import { LogConflictError } from '../types'
import type { RunState, RunStore, WorkflowEvent } from '../types'

export interface InMemoryRunStoreOptions {
  /** TTL in milliseconds for finished/errored/aborted runs. Paused
   *  runs are exempt. Default 1 hour. */
  ttl?: number
}

export type InMemoryRunStore = RunStore

/**
 * In-memory backing store. Holds per-run state + append-only event
 * log + optional push subscribers. Suitable for single-process
 * prototypes and the test suite.
 */
export function inMemoryRunStore(
  options: InMemoryRunStoreOptions = {},
): InMemoryRunStore {
  const ttl = options.ttl ?? 60 * 60 * 1000
  const runs = new Map<string, RunState>()
  const logs = new Map<string, Array<WorkflowEvent>>()
  const expirations = new Map<string, ReturnType<typeof setTimeout>>()
  const subscribers = new Map<
    string,
    Set<(event: WorkflowEvent, index: number) => void>
  >()

  function scheduleExpiry(runId: string, state?: RunState) {
    const existing = expirations.get(runId)
    if (existing) clearTimeout(existing)
    // Paused runs are intentional persistence — engine cleans them up
    // when they finish/error/abort via `deleteRun`.
    if (state?.status === 'paused') return
    const handle = setTimeout(() => {
      runs.delete(runId)
      logs.delete(runId)
      expirations.delete(runId)
      subscribers.delete(runId)
    }, ttl)
    expirations.set(runId, handle)
  }

  return {
    getRunState(runId) {
      return Promise.resolve(runs.get(runId))
    },
    setRunState(runId, state) {
      runs.set(runId, state)
      scheduleExpiry(runId, state)
      return Promise.resolve()
    },
    deleteRun(runId, _reason) {
      runs.delete(runId)
      logs.delete(runId)
      const handle = expirations.get(runId)
      if (handle) clearTimeout(handle)
      expirations.delete(runId)
      subscribers.delete(runId)
      return Promise.resolve()
    },

    appendEvent(runId, expectedNextIndex, event) {
      const log = logs.get(runId) ?? []
      if (log.length !== expectedNextIndex) {
        return Promise.reject(
          new LogConflictError(runId, expectedNextIndex, log[expectedNextIndex]),
        )
      }
      log.push(event)
      logs.set(runId, log)
      scheduleExpiry(runId, runs.get(runId))
      const subs = subscribers.get(runId)
      if (subs) {
        const index = log.length - 1
        for (const cb of subs) {
          try {
            cb(event, index)
          } catch {
            /* Subscriber errors must not break the append. */
          }
        }
      }
      return Promise.resolve()
    },
    getEvents(runId) {
      const log = logs.get(runId)
      return Promise.resolve(log ? [...log] : [])
    },

    subscribe(runId, fromIndex, onEvent) {
      const log = logs.get(runId) ?? []
      for (let i = fromIndex; i < log.length; i++) {
        try {
          onEvent(log[i]!, i)
        } catch {
          /* swallow */
        }
      }
      let subs = subscribers.get(runId)
      if (!subs) {
        subs = new Set()
        subscribers.set(runId, subs)
      }
      const set = subs
      set.add(onEvent)
      return () => {
        set.delete(onEvent)
        if (set.size === 0) subscribers.delete(runId)
      }
    },
  }
}
