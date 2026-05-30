import { createCloudflareWorkflowScheduledHandler } from '@tanstack/workflow-cloudflare'
import { createRuntime, type Env } from './runtime'
import type { FulfillmentInput, PaymentReceivedPayload } from './workflows'
import type { WorkflowRuntimeDefinition } from '@tanstack/workflow-runtime'

interface StartRunBody {
  runId?: string
  orderId?: string
  amount?: number
  delayMs?: number
  readyAt?: number
}

interface PaymentSignalBody {
  runId: string
  paymentId?: string
  provider?: string
  signalId?: string
}

const scheduled = createCloudflareWorkflowScheduledHandler({
  runtime: ({ env }: { env: Env }) => createRuntime(env),
  maxScheduledRuns: 10,
  maxTimers: 25,
  maxDurationMs: 25_000,
  includeEvents: false,
})

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const runtime = createRuntime(env)

    try {
      if (url.pathname === '/' && request.method === 'GET') {
        return json({
          ok: true,
          demo: 'tanstack-workflow-cloudflare-d1-poc',
          endpoints: {
            startRun: 'POST /runs',
            listRuns: 'GET /runs',
            getTimeline: 'GET /runs/:runId',
            paymentSignal: 'POST /signals/payment',
            sweep: 'POST /sweep',
          },
        })
      }

      if (url.pathname === '/runs' && request.method === 'POST') {
        return json(
          await startRun(runtime, await readJson<StartRunBody>(request)),
        )
      }

      if (url.pathname === '/runs' && request.method === 'GET') {
        return json(
          await runtime.store.listRuns({
            workflowId: url.searchParams.get('workflowId') ?? undefined,
            status:
              (url.searchParams.get('status') as
                | Parameters<typeof runtime.store.listRuns>[0]['status']
                | null) ?? undefined,
            limit: Number(url.searchParams.get('limit') ?? 25),
            cursor: url.searchParams.get('cursor') ?? undefined,
          }),
        )
      }

      if (url.pathname.startsWith('/runs/') && request.method === 'GET') {
        const runId = decodeURIComponent(url.pathname.slice('/runs/'.length))
        const timeline = await runtime.store.getRunTimeline(runId)
        return timeline ? json(timeline) : json({ error: 'not-found' }, 404)
      }

      if (url.pathname === '/signals/payment' && request.method === 'POST') {
        return json(
          await deliverPayment(
            runtime,
            await readJson<PaymentSignalBody>(request),
          ),
        )
      }

      if (url.pathname === '/sweep' && request.method === 'POST') {
        if (!isAuthorized(request, env))
          return json({ error: 'unauthorized' }, 401)

        return json(
          await runtime.sweep({
            maxScheduledRuns: 10,
            maxTimers: 25,
            maxDurationMs: 25_000,
            leaseOwner: `manual:${Date.now()}`,
            includeEvents: false,
          }),
        )
      }

      return json({ error: 'not-found' }, 404)
    } catch (error) {
      return json(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        400,
      )
    }
  },

  scheduled,
}

async function startRun(
  runtime: WorkflowRuntimeDefinition,
  body: StartRunBody,
) {
  const orderId = body.orderId ?? `order-${Date.now()}`
  const input: FulfillmentInput = {
    orderId,
    amount: body.amount ?? 4200,
    readyAt: body.readyAt ?? Date.now() + (body.delayMs ?? 30_000),
  }
  const runId = body.runId ?? `d1-fulfillment:${orderId}`

  return await runtime.startRun({
    workflowId: 'd1-fulfillment',
    runId,
    input,
    leaseOwner: 'http:start',
    includeEvents: true,
  })
}

async function deliverPayment(
  runtime: WorkflowRuntimeDefinition,
  body: PaymentSignalBody,
) {
  const paymentId = body.paymentId ?? `pay-${Date.now()}`
  const payload: PaymentReceivedPayload = {
    paymentId,
    provider: body.provider ?? 'demo',
  }

  return await runtime.deliverSignal({
    runId: body.runId,
    signalId: body.signalId ?? `payment:${paymentId}`,
    name: 'payment-received',
    payload,
    leaseOwner: 'http:payment',
    includeEvents: true,
  })
}

async function readJson<T>(request: Request): Promise<T> {
  return (await request.json()) as T
}

function isAuthorized(request: Request, env: Env) {
  if (!env.CRON_SECRET) return true
  return request.headers.get('authorization') === `Bearer ${env.CRON_SECRET}`
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status })
}
