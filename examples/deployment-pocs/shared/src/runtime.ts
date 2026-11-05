import { runWorkflow } from '@tanstack/workflow-core'
import type {
  RunStore,
  SignalDelivery,
  WorkflowEvent,
} from '@tanstack/workflow-core'
import { httpRunStore } from './http-run-store.js'
import {
  fulfillmentWorkflow,
  scheduledDigestWorkflow,
  type FulfillmentInput,
  type PaymentReceivedPayload,
} from './workflows.js'
import {
  upstashRunStore,
  type TimerRunStore,
  type UpstashRunStoreOptions,
} from './upstash-run-store.js'

export type DemoAction =
  | {
      type: 'start'
      runId?: string
      orderId?: string
      amount?: number
      delayMs?: number
      readyAt?: number
    }
  | {
      type: 'payment'
      runId: string
      paymentId?: string
      provider?: string
      signalId?: string
    }
  | {
      type: 'attach'
      runId: string
    }

export interface DemoResult {
  runId?: string
  events: ReadonlyArray<WorkflowEvent>
  dueTimers?: ReadonlyArray<{ runId: string; deadline: number }>
}

export interface RuntimeEnv {
  WORKFLOW_STORE_TOKEN?: string
  WORKFLOW_STORE_URL?: string
  UPSTASH_REDIS_REST_URL?: string
  UPSTASH_REDIS_REST_TOKEN?: string
  WORKFLOW_KEY_PREFIX?: string
}

export function createRunStoreFromEnv(env: RuntimeEnv): TimerRunStore {
  if (env.WORKFLOW_STORE_URL) {
    return httpRunStore({
      url: env.WORKFLOW_STORE_URL,
      token: env.WORKFLOW_STORE_TOKEN,
    })
  }

  const url = env.UPSTASH_REDIS_REST_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    throw new Error(
      'Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN.',
    )
  }

  const options: UpstashRunStoreOptions = {
    url,
    token,
    keyPrefix: env.WORKFLOW_KEY_PREFIX,
  }

  return upstashRunStore(options)
}

export async function handleDemoAction(
  runStore: RunStore,
  action: DemoAction,
): Promise<DemoResult> {
  if (action.type === 'start') {
    return startFulfillment(runStore, action)
  }

  if (action.type === 'payment') {
    return signalPayment(runStore, action)
  }

  return attachRun(runStore, action.runId)
}

export async function runDueTimers(
  runStore: TimerRunStore,
  now = Date.now(),
): Promise<DemoResult> {
  const dueTimers = await runStore.listDueTimers(now)
  const events: Array<WorkflowEvent> = []

  for (const timer of dueTimers) {
    const delivery: SignalDelivery<void> = {
      signalId: `timer:${timer.runId}:${timer.deadline}`,
      name: '__timer',
      payload: undefined,
    }

    events.push(
      ...(await collect(
        runWorkflow({
          workflow: fulfillmentWorkflow,
          runId: timer.runId,
          runStore,
          signalDelivery: delivery,
        }),
      )),
    )
  }

  return { events, dueTimers }
}

export async function runScheduledDigest(
  runStore: RunStore,
  now = Date.now(),
): Promise<DemoResult> {
  const scheduleId = 'minute-digest'
  const minute = Math.floor(now / 60_000) * 60_000
  const runId = `digest:${scheduleId}:${minute}`

  return {
    runId,
    events: await collect(
      runWorkflow({
        workflow: scheduledDigestWorkflow,
        runId,
        runStore,
        input: { triggeredAt: now, scheduleId },
      }),
    ),
  }
}

async function startFulfillment(
  runStore: RunStore,
  action: Extract<DemoAction, { type: 'start' }>,
): Promise<DemoResult> {
  const orderId = action.orderId ?? `order-${Date.now()}`
  const input: FulfillmentInput = {
    orderId,
    amount: action.amount ?? 4200,
    readyAt: action.readyAt ?? Date.now() + (action.delayMs ?? 30_000),
  }
  const runId = action.runId ?? `fulfillment:${orderId}`

  return {
    runId,
    events: await collect(
      runWorkflow({
        workflow: fulfillmentWorkflow,
        runId,
        runStore,
        input,
      }),
    ),
  }
}

async function signalPayment(
  runStore: RunStore,
  action: Extract<DemoAction, { type: 'payment' }>,
): Promise<DemoResult> {
  const paymentId = action.paymentId ?? `pay-${Date.now()}`
  const payload: PaymentReceivedPayload = {
    paymentId,
    provider: action.provider ?? 'demo',
  }

  return {
    runId: action.runId,
    events: await collect(
      runWorkflow({
        workflow: fulfillmentWorkflow,
        runId: action.runId,
        runStore,
        signalDelivery: {
          signalId: action.signalId ?? `payment:${paymentId}`,
          name: 'payment-received',
          payload,
        },
      }),
    ),
  }
}

async function attachRun(
  runStore: RunStore,
  runId: string,
): Promise<DemoResult> {
  return {
    runId,
    events: await collect(
      runWorkflow({
        workflow: fulfillmentWorkflow,
        runId,
        runStore,
        attach: true,
      }),
    ),
  }
}

async function collect(
  iterable: AsyncIterable<WorkflowEvent>,
): Promise<Array<WorkflowEvent>> {
  const events: Array<WorkflowEvent> = []
  for await (const event of iterable) {
    events.push(event)
  }
  return events
}
