import {
  createRunStoreFromEnv,
  handleDemoAction,
  type DemoAction,
} from '../../../../shared/src/runtime.js'

export async function GET() {
  return Response.json({
    ok: true,
    endpoints: {
      start: 'POST /api/workflow { "type": "start", "delayMs": 30000 }',
      attach: 'POST /api/workflow { "type": "attach", "runId": "..." }',
      payment:
        'POST /api/workflow { "type": "payment", "runId": "...", "paymentId": "..." }',
    },
  })
}

export async function POST(request: Request) {
  try {
    const action = (await request.json()) as DemoAction
    const runStore = createRunStoreFromEnv(process.env)
    const result = await handleDemoAction(runStore, action)

    return Response.json(result)
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 400 },
    )
  }
}
