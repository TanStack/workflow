# Cloudflare POC

This demo uses a Worker `fetch` handler as HTTP ingress and Cloudflare Cron
Triggers as timer and schedule wake-ups.

## Routes

- `POST /workflow`: start, attach, or signal a fulfillment run.
- `GET /cron/timers`: sweep due `ctx.sleepUntil` runs.
- `GET /cron/digest`: start a fresh scheduled digest run.
- `POST /store`: HTTP `RunStore` endpoint backed by a Durable Object.

The Worker also implements `scheduled()`. The `* * * * *` cron trigger sweeps
timers, and the `*/5 * * * *` trigger starts digest runs.

## Environment

```bash
CRON_SECRET=optional-shared-secret
STORE_TOKEN=optional-shared-store-secret
```

For local development, use Wrangler secrets or a `.dev.vars` file.

## Cron config

`wrangler.toml` configures:

```toml
[triggers]
crons = ["* * * * *", "*/5 * * * *"]
```

## Local run

```bash
pnpm install
pnpm dev
```

Use the Wrangler local URL:

```bash
curl -X POST "http://localhost:8787/workflow" \
  -H 'content-type: application/json' \
  -d '{ "type": "start", "orderId": "cloudflare-1", "delayMs": 30000 }'

curl "http://localhost:8787/cron/timers"

curl -X POST "http://localhost:8787/workflow" \
  -H 'content-type: application/json' \
  -d '{ "type": "payment", "runId": "fulfillment:cloudflare-1", "paymentId": "pay-cloudflare-1" }'
```

## What to verify

- The Worker invocation exits at every pause.
- Cron Triggers only wake due work; they do not own workflow state.
- The same shared runtime code is used by HTTP and scheduled handlers.
