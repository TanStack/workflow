import type {
  DeleteReason,
  RunState,
  WorkflowEvent,
  WorkflowTelemetry,
} from '@tanstack/workflow-core'
import type {
  WorkflowRunStoreAdapter,
  WorkflowRunStoreAdapterStore,
} from './types'

export function createRunStoreAdapter(
  store: WorkflowRunStoreAdapterStore,
  telemetry?: WorkflowTelemetry,
  options: {
    leaseOwner?: string
    onError?: (error: unknown) => void
    assertHealthy?: () => void
  } = {},
): WorkflowRunStoreAdapter {
  const { leaseOwner } = options
  async function access<T>(operation: string, fn: () => Promise<T>) {
    try {
      options.assertHealthy?.()
      return await traceStoreOperation(telemetry, operation, fn)
    } catch (error) {
      options.onError?.(error)
      throw error
    }
  }
  return {
    assertHealthy: options.assertHealthy,
    consumeBufferedSignal: store.consumeBufferedSignal
      ? (args) =>
          access('store.consume_buffered_signal', () =>
            store.consumeBufferedSignal!({ ...args, leaseOwner }),
          )
      : undefined,
    getRunState(runId) {
      return access('store.load_run_state', () => store.loadRunState(runId))
    },

    setRunState(_runId: string, state: RunState) {
      return access('store.save_run_state', () =>
        store.saveRunState({ state, leaseOwner }),
      )
    },

    deleteRun(runId: string, reason: DeleteReason) {
      return access('store.delete_run', () => store.deleteRun(runId, reason))
    },

    async appendEvent(
      runId: string,
      expectedNextIndex: number,
      event: WorkflowEvent,
    ) {
      await access('store.append_events', () =>
        store.appendEvents({
          runId,
          leaseOwner,
          expectedNextIndex,
          events: [event],
        }),
      )
    },

    async getEvents(runId: string) {
      const events = await access('store.read_events', () =>
        store.readEvents({ runId }),
      )
      return events.map((event) => event.event)
    },

    subscribe: store.subscribeEvents
      ? (runId, fromIndex, onEvent) =>
          store.subscribeEvents!(runId, fromIndex, onEvent)
      : undefined,
  }
}

async function traceStoreOperation<T>(
  telemetry: WorkflowTelemetry | undefined,
  operation: string,
  fn: () => Promise<T>,
) {
  if (!telemetry) return await fn()
  return await telemetry.startActiveSpan(operation, {}, fn)
}
