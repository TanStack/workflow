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
): WorkflowRunStoreAdapter {
  return {
    getRunState(runId) {
      return traceStoreOperation(telemetry, 'store.load_run_state', () =>
        store.loadRunState(runId),
      )
    },

    setRunState(_runId: string, state: RunState) {
      return traceStoreOperation(telemetry, 'store.save_run_state', () =>
        store.saveRunState({ state }),
      )
    },

    deleteRun(runId: string, reason: DeleteReason) {
      return traceStoreOperation(telemetry, 'store.delete_run', () =>
        store.deleteRun(runId, reason),
      )
    },

    async appendEvent(
      runId: string,
      expectedNextIndex: number,
      event: WorkflowEvent,
    ) {
      await traceStoreOperation(telemetry, 'store.append_events', () =>
        store.appendEvents({
          runId,
          expectedNextIndex,
          events: [event],
        }),
      )
    },

    async getEvents(runId: string) {
      const events = await traceStoreOperation(
        telemetry,
        'store.read_events',
        () => store.readEvents({ runId }),
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
