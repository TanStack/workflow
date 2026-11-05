import { LogConflictError } from '@tanstack/workflow-core'
import type {
  DeleteReason,
  RunState,
  WorkflowEvent,
} from '@tanstack/workflow-core'
import type { TimerRunStore } from './upstash-run-store.js'

export interface HttpRunStoreOptions {
  url: string
  token?: string
}

type StoreRequest =
  | { type: 'getRunState'; runId: string }
  | { type: 'setRunState'; runId: string; state: RunState }
  | { type: 'deleteRun'; runId: string; reason: DeleteReason }
  | {
      type: 'appendEvent'
      runId: string
      expectedNextIndex: number
      event: WorkflowEvent
    }
  | { type: 'getEvents'; runId: string }
  | { type: 'listDueTimers'; now: number; limit?: number }

interface StoreResponse<T> {
  ok: boolean
  value?: T
  error?: string
  existing?: WorkflowEvent
}

export function httpRunStore(options: HttpRunStoreOptions): TimerRunStore {
  const url = options.url.replace(/\/$/, '')

  const request = async <T>(body: StoreRequest): Promise<StoreResponse<T>> => {
    const response = await fetch(`${url}/store`, {
      method: 'POST',
      headers: {
        ...(options.token
          ? { authorization: `Bearer ${options.token}` }
          : undefined),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const payload = (await response.json()) as StoreResponse<T>
    if (!response.ok && payload.error !== 'conflict') {
      throw new Error(payload.error ?? `HTTP store failed: ${body.type}`)
    }
    return payload
  }

  return {
    async getRunState(runId) {
      const response = await request<RunState | undefined>({
        type: 'getRunState',
        runId,
      })
      return response.value
    },

    async setRunState(runId, state) {
      await request<void>({ type: 'setRunState', runId, state })
    },

    async deleteRun(runId, reason) {
      await request<void>({ type: 'deleteRun', runId, reason })
    },

    async appendEvent(runId, expectedNextIndex, event) {
      const response = await request<void>({
        type: 'appendEvent',
        runId,
        expectedNextIndex,
        event,
      })

      if (!response.ok && response.error === 'conflict') {
        throw new LogConflictError(runId, expectedNextIndex, response.existing)
      }
    },

    async getEvents(runId) {
      const response = await request<ReadonlyArray<WorkflowEvent>>({
        type: 'getEvents',
        runId,
      })
      return response.value ?? []
    },

    async listDueTimers(now, limit) {
      const response = await request<
        ReadonlyArray<{ runId: string; deadline: number }>
      >({
        type: 'listDueTimers',
        now,
        limit,
      })
      return response.value ?? []
    },
  }
}
