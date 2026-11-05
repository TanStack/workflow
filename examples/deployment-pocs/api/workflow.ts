import {
  createRunStoreFromEnv,
  handleDemoAction,
  type DemoAction,
} from '../shared/src/runtime.js'

interface VercelRequest {
  method?: string
  body?: unknown
}

interface VercelResponse {
  status: (code: number) => VercelResponse
  json: (body: unknown) => void
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      endpoints: {
        start: 'POST /api/workflow { "type": "start", "delayMs": 30000 }',
        attach: 'POST /api/workflow { "type": "attach", "runId": "..." }',
        payment:
          'POST /api/workflow { "type": "payment", "runId": "...", "paymentId": "..." }',
      },
    })
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  try {
    const action = parseBody(req.body)
    const runStore = createRunStoreFromEnv(process.env)
    const result = await handleDemoAction(runStore, action)

    res.status(200).json(result)
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

function parseBody(body: unknown): DemoAction {
  if (typeof body === 'string') return JSON.parse(body) as DemoAction
  return body as DemoAction
}
