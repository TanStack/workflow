import type {
  DeleteReason,
  RunState,
  WorkflowEvent,
} from '@tanstack/workflow-core'
import type {
  WorkflowRunStoreAdapter,
  WorkflowRunStoreAdapterStore,
} from './types'

export function createRunStoreAdapter(
  store: WorkflowRunStoreAdapterStore,
): WorkflowRunStoreAdapter {
  return {
    getRunState(runId) {
      return store.loadRunState(runId)
    },

    setRunState(_runId: string, state: RunState) {
      return store.saveRunState({ state })
    },

    deleteRun(runId: string, reason: DeleteReason) {
      return store.deleteRun(runId, reason)
    },

    async appendEvent(
      runId: string,
      expectedNextIndex: number,
      event: WorkflowEvent,
    ) {
      await store.appendEvents({
        runId,
        expectedNextIndex,
        events: [event],
      })
    },

    async getEvents(runId: string) {
      const events = await store.readEvents({ runId })
      return events.map((event) => event.event)
    },

    subscribe: store.subscribeEvents
      ? (runId, fromIndex, onEvent) =>
          store.subscribeEvents!(runId, fromIndex, onEvent)
      : undefined,
  }
}
