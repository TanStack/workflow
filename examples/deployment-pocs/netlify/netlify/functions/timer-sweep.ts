import {
  createRunStoreFromEnv,
  runDueTimers,
} from '../../../shared/src/runtime.js'

export const config = {
  schedule: '* * * * *',
}

export async function handler() {
  try {
    const runStore = createRunStoreFromEnv(process.env)
    const result = await runDueTimers(runStore)

    return json(200, result)
  } catch (error) {
    return json(500, {
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
