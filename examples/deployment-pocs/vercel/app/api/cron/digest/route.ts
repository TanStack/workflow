import {
  createRunStoreFromEnv,
  runScheduledDigest,
} from '../../../../../shared/src/runtime.js'

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }

  const runStore = createRunStoreFromEnv(process.env)
  const result = await runScheduledDigest(runStore)

  return Response.json(result)
}

function isAuthorizedCron(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) return true

  return request.headers.get('authorization') === `Bearer ${expected}`
}
