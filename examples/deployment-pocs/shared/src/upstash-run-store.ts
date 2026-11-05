import { LogConflictError } from '@tanstack/workflow-core'
import type {
  DeleteReason,
  RunState,
  RunStore,
  WorkflowEvent,
} from '@tanstack/workflow-core'

export interface TimerRunStore extends RunStore {
  listDueTimers: (
    now: number,
    limit?: number,
  ) => Promise<ReadonlyArray<{ runId: string; deadline: number }>>
}

export interface UpstashRunStoreOptions {
  url: string
  token: string
  keyPrefix?: string
}

type RedisCommand = ReadonlyArray<string | number>

interface RedisResponse<T> {
  result?: T
  error?: string
}

const appendEventScript = `
local expected = tonumber(ARGV[1])
local current = redis.call("LLEN", KEYS[1])
if current ~= expected then
  return {"conflict", redis.call("LINDEX", KEYS[1], expected)}
end
redis.call("RPUSH", KEYS[1], ARGV[2])
return {"ok"}
`

export function upstashRunStore(
  options: UpstashRunStoreOptions,
): TimerRunStore {
  const baseUrl = options.url.replace(/\/$/, '')
  const keyPrefix = options.keyPrefix ?? 'tanstack-workflow-poc'

  const command = async <T>(cmd: RedisCommand): Promise<T> => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(cmd),
    })

    const payload = (await response.json()) as RedisResponse<T>
    if (!response.ok || payload.error) {
      throw new Error(payload.error ?? `Redis command failed: ${cmd[0]}`)
    }
    return payload.result as T
  }

  const stateKey = (runId: string) => `${keyPrefix}:state:${runId}`
  const logKey = (runId: string) => `${keyPrefix}:log:${runId}`
  const timersKey = `${keyPrefix}:timers`

  const updateTimerIndex = async (state: RunState) => {
    const deadline = state.waitingFor?.deadline
    if (
      state.status === 'paused' &&
      state.waitingFor?.signalName === '__timer' &&
      typeof deadline === 'number'
    ) {
      await command<number>(['ZADD', timersKey, deadline, state.runId])
      return
    }

    await command<number>(['ZREM', timersKey, state.runId])
  }

  return {
    async getRunState(runId) {
      const raw = await command<string | null>(['GET', stateKey(runId)])
      return raw ? (JSON.parse(raw) as RunState) : undefined
    },

    async setRunState(runId, state) {
      await command<string>(['SET', stateKey(runId), JSON.stringify(state)])
      await updateTimerIndex(state)
    },

    async deleteRun(runId, _reason: DeleteReason) {
      await command<number>(['DEL', stateKey(runId), logKey(runId)])
      await command<number>(['ZREM', timersKey, runId])
    },

    async appendEvent(runId, expectedNextIndex, event) {
      const result = await command<[string, string | null]>([
        'EVAL',
        appendEventScript,
        1,
        logKey(runId),
        expectedNextIndex,
        JSON.stringify(event),
      ])

      if (result[0] === 'conflict') {
        throw new LogConflictError(
          runId,
          expectedNextIndex,
          result[1] ? (JSON.parse(result[1]) as WorkflowEvent) : undefined,
        )
      }
    },

    async getEvents(runId) {
      const rawEvents = await command<Array<string>>([
        'LRANGE',
        logKey(runId),
        0,
        -1,
      ])
      return rawEvents.map((event) => JSON.parse(event) as WorkflowEvent)
    },

    async listDueTimers(now, limit = 25) {
      const runIds = await command<Array<string>>([
        'ZRANGEBYSCORE',
        timersKey,
        '-inf',
        now,
        'LIMIT',
        0,
        limit,
      ])

      const timers: Array<{ runId: string; deadline: number }> = []
      for (const runId of runIds) {
        const state = await this.getRunState(runId)
        const deadline = state?.waitingFor?.deadline
        if (
          state?.status === 'paused' &&
          state.waitingFor?.signalName === '__timer' &&
          typeof deadline === 'number' &&
          deadline <= now
        ) {
          timers.push({ runId, deadline })
        } else {
          await command<number>(['ZREM', timersKey, runId])
        }
      }
      return timers
    },
  }
}
