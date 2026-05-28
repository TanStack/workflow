# Vercel POC

This demo uses Next route handlers as the HTTP ingress and Vercel Cron as the
timer and schedule wake-up mechanism.

## Routes

- `POST /api/workflow`: start, attach, or signal a fulfillment run.
- `GET /api/cron/timers`: sweep due `ctx.sleepUntil` runs.
- `GET /api/cron/digest`: start a fresh scheduled digest run.

## Environment

```bash
WORKFLOW_STORE_URL=https://tanstack-workflow-cloudflare-poc.tannerlinsley.workers.dev
WORKFLOW_STORE_TOKEN=optional-shared-store-secret
CRON_SECRET=optional-shared-secret
```

When `CRON_SECRET` is set, cron routes require:

```http
Authorization: Bearer <CRON_SECRET>
```

## Cron config

`vercel.json` configures:

```json
{
  "crons": [
    { "path": "/api/cron/timers", "schedule": "0 0 * * *" },
    { "path": "/api/cron/digest", "schedule": "5 0 * * *" }
  ]
}
```

The POC uses daily schedules so it can deploy on Vercel Hobby accounts. Call
the cron routes manually when smoke-testing timers.

## Local run

```bash
pnpm install
pnpm dev
```

Use `http://localhost:3000/api` paths:

```bash
curl -X POST "http://localhost:3000/api/workflow" \
  -H 'content-type: application/json' \
  -d '{ "type": "start", "orderId": "vercel-1", "delayMs": 30000 }'

curl "http://localhost:3000/api/cron/timers"

curl -X POST "http://localhost:3000/api/workflow" \
  -H 'content-type: application/json' \
  -d '{ "type": "payment", "runId": "fulfillment:vercel-1", "paymentId": "pay-vercel-1" }'
```

## What to verify

- Start returns events through `SIGNAL_AWAITED` for `__timer`.
- Timer cron returns events that include `SIGNAL_RESOLVED` for `__timer` and
  then `SIGNAL_AWAITED` for `payment-received`.
- Payment signal returns `RUN_FINISHED`.
