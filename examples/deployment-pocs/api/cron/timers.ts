import {
  createRunStoreFromEnv,
  runDueTimers,
} from '../../shared/src/runtime.js'

interface VercelRequest {
  headers: Record<string, string | string[] | undefined>
}

interface VercelResponse {
  status: (code: number) => VercelResponse
  json: (body: unknown) => void
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorizedCron(req)) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  try {
    const runStore = createRunStoreFromEnv(process.env)
    const result = await runDueTimers(runStore)

    res.status(200).json(result)
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

function isAuthorizedCron(request: VercelRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return true

  return request.headers.authorization === `Bearer ${expected}`
}
