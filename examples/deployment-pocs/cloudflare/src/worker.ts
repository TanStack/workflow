import {
  handleDemoAction,
  runDueTimers,
  runScheduledDigest,
  type DemoAction,
} from '../../shared/src/runtime.js'
import {
  LogConflictError,
  type DeleteReason,
  type RunState,
  type RunStore,
  type WorkflowEvent,
} from '@tanstack/workflow-core'
import type { TimerRunStore } from '../../shared/src/upstash-run-store.js'

interface Env {
  CRON_SECRET?: string
  STORE_TOKEN?: string
  WORKFLOW_STORE: DurableObjectNamespace
}

interface DurableObjectNamespace {
  idFromName: (name: string) => DurableObjectId
  get: (id: DurableObjectId) => DurableObjectStub
}

interface DurableObjectId {}

interface DurableObjectStub {
  fetch: (request: Request) => Promise<Response>
}

interface DurableObjectState {
  storage: DurableObjectStorage
}

interface DurableObjectStorage {
  get: <T>(key: string) => Promise<T | undefined>
  put: <T>(key: string, value: T) => Promise<void>
  delete: (key: string) => Promise<boolean>
  transaction: <T>(
    callback: (transaction: DurableObjectStorageTransaction) => Promise<T>,
  ) => Promise<T>
}

interface DurableObjectStorageTransaction {
  get: <T>(key: string) => Promise<T | undefined>
  put: <T>(key: string, value: T) => Promise<void>
  delete: (key: string) => Promise<boolean>
}

interface ExecutionContext {
  waitUntil: (promise: Promise<unknown>) => void
}

interface ScheduledController {
  cron: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    try {
      if (url.pathname === '/store' && request.method === 'POST') {
        if (!isAuthorizedStore(request, env)) {
          return json({ error: 'unauthorized' }, 401)
        }

        return env.WORKFLOW_STORE.get(
          env.WORKFLOW_STORE.idFromName('default'),
        ).fetch(request)
      }

      if (url.pathname === '/workflow' && request.method === 'POST') {
        const action = (await request.json()) as DemoAction
        const runStore = cloudflareRunStore(env)
        return json(await handleDemoAction(runStore, action))
      }

      if (url.pathname === '/cron/timers' && request.method === 'GET') {
        if (!isAuthorizedCron(request, env)) {
          return json({ error: 'unauthorized' }, 401)
        }

        const runStore = cloudflareRunStore(env)
        return json(await runDueTimers(runStore))
      }

      if (url.pathname === '/cron/digest' && request.method === 'GET') {
        if (!isAuthorizedCron(request, env)) {
          return json({ error: 'unauthorized' }, 401)
        }

        const runStore = cloudflareRunStore(env)
        return json(await runScheduledDigest(runStore))
      }

      return json({
        ok: true,
        endpoints: {
          workflow: 'POST /workflow',
          timers: 'GET /cron/timers',
          digest: 'GET /cron/digest',
        },
      })
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400,
      )
    }
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ) {
    const runStore = cloudflareRunStore(env)

    if (controller.cron === '* * * * *') {
      ctx.waitUntil(runDueTimers(runStore))
      return
    }

    ctx.waitUntil(runScheduledDigest(runStore))
  },
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

export class WorkflowStoreObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const body = (await request.json()) as StoreRequest

    if (body.type === 'getRunState') {
      return storeJson({
        ok: true,
        value: await this.state.storage.get<RunState>(stateKey(body.runId)),
      })
    }

    if (body.type === 'setRunState') {
      await this.state.storage.put(stateKey(body.runId), body.state)
      await this.updateTimerIndex(body.state)
      return storeJson({ ok: true })
    }

    if (body.type === 'deleteRun') {
      await this.state.storage.delete(stateKey(body.runId))
      await this.state.storage.delete(logKey(body.runId))
      await this.removeTimer(body.runId)
      return storeJson({ ok: true })
    }

    if (body.type === 'appendEvent') {
      return this.appendEvent(body)
    }

    if (body.type === 'getEvents') {
      return storeJson({
        ok: true,
        value:
          (await this.state.storage.get<Array<WorkflowEvent>>(
            logKey(body.runId),
          )) ?? [],
      })
    }

    return storeJson({
      ok: true,
      value: await this.listDueTimers(body.now, body.limit ?? 25),
    })
  }

  private async appendEvent(
    body: Extract<StoreRequest, { type: 'appendEvent' }>,
  ) {
    const result = await this.state.storage.transaction(async (transaction) => {
      const key = logKey(body.runId)
      const log = (await transaction.get<Array<WorkflowEvent>>(key)) ?? []

      if (log.length !== body.expectedNextIndex) {
        return {
          ok: false,
          error: 'conflict',
          existing: log[body.expectedNextIndex],
        }
      }

      log.push(body.event)
      await transaction.put(key, log)
      return { ok: true }
    })

    return storeJson(result, result.ok ? 200 : 409)
  }

  private async updateTimerIndex(state: RunState) {
    const timers = await this.getTimers()
    const deadline = state.waitingFor?.deadline

    if (
      state.status === 'paused' &&
      state.waitingFor?.signalName === '__timer' &&
      typeof deadline === 'number'
    ) {
      timers[state.runId] = deadline
    } else {
      delete timers[state.runId]
    }

    await this.state.storage.put(timersKey, timers)
  }

  private async removeTimer(runId: string) {
    const timers = await this.getTimers()
    delete timers[runId]
    await this.state.storage.put(timersKey, timers)
  }

  private async listDueTimers(now: number, limit: number) {
    const timers = await this.getTimers()
    return Object.entries(timers)
      .filter(([, deadline]) => deadline <= now)
      .slice(0, limit)
      .map(([runId, deadline]) => ({ runId, deadline }))
  }

  private async getTimers() {
    return (
      (await this.state.storage.get<Record<string, number>>(timersKey)) ?? {}
    )
  }
}

function cloudflareRunStore(env: Env): TimerRunStore {
  const stub = env.WORKFLOW_STORE.get(env.WORKFLOW_STORE.idFromName('default'))

  const request = async <T>(body: StoreRequest): Promise<T> => {
    const response = await stub.fetch(
      new Request('https://workflow-store.local/store', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
    const payload = (await response.json()) as {
      ok: boolean
      value?: T
      error?: string
      existing?: WorkflowEvent
    }

    if (!response.ok && payload.error !== 'conflict') {
      throw new Error(payload.error ?? `Cloudflare store failed: ${body.type}`)
    }

    if (!payload.ok && payload.error === 'conflict') {
      const append = body as Extract<StoreRequest, { type: 'appendEvent' }>
      throw new LogConflictError(
        append.runId,
        append.expectedNextIndex,
        payload.existing,
      )
    }

    return payload.value as T
  }

  return {
    getRunState: (runId) => request({ type: 'getRunState', runId }),
    setRunState: (runId, state) =>
      request({ type: 'setRunState', runId, state }),
    deleteRun: (runId, reason) => request({ type: 'deleteRun', runId, reason }),
    appendEvent: (runId, expectedNextIndex, event) =>
      request({ type: 'appendEvent', runId, expectedNextIndex, event }),
    getEvents: (runId) => request({ type: 'getEvents', runId }),
    listDueTimers: (now, limit) =>
      request({ type: 'listDueTimers', now, limit }),
  }
}

function isAuthorizedCron(request: Request, env: Env) {
  if (!env.CRON_SECRET) return true

  return request.headers.get('authorization') === `Bearer ${env.CRON_SECRET}`
}

function isAuthorizedStore(request: Request, env: Env) {
  if (!env.STORE_TOKEN) return true

  return request.headers.get('authorization') === `Bearer ${env.STORE_TOKEN}`
}

const timersKey = 'timers'

function stateKey(runId: string) {
  return `state:${runId}`
}

function logKey(runId: string) {
  return `log:${runId}`
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function storeJson(body: unknown, status = 200) {
  return json(body, status)
}
