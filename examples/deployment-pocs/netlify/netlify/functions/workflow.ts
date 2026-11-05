import {
  createRunStoreFromEnv,
  handleDemoAction,
  type DemoAction,
} from '../../../shared/src/runtime.js'

interface NetlifyEvent {
  body?: string | null
}

export async function handler(event: NetlifyEvent) {
  try {
    const action = JSON.parse(event.body || '{"type":"start"}') as DemoAction
    const runStore = createRunStoreFromEnv(process.env)
    const result = await handleDemoAction(runStore, action)

    return json(200, result)
  } catch (error) {
    return json(400, {
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}
