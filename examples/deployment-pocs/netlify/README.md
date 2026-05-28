# Netlify POC

This demo uses Netlify Functions as HTTP ingress and Netlify Scheduled Functions
as timer and schedule wake-ups.

## Routes

- `POST /.netlify/functions/workflow`: start, attach, or signal a fulfillment run.
- `GET /.netlify/functions/timer-sweep`: sweep due `ctx.sleepUntil` runs.
- `GET /.netlify/functions/scheduled-digest`: start a fresh scheduled digest run.

## Environment

```bash
WORKFLOW_STORE_URL=https://tanstack-workflow-cloudflare-poc.tannerlinsley.workers.dev
WORKFLOW_STORE_TOKEN=optional-shared-store-secret
```

## Scheduled config

`netlify.toml` configures:

```toml
[functions."timer-sweep"]
  schedule = "* * * * *"

[functions."scheduled-digest"]
  schedule = "*/5 * * * *"
```

## Local run

Install the Netlify CLI, then run from this directory:

```bash
netlify dev
```

Use `http://localhost:8888` paths:

```bash
curl -X POST "http://localhost:8888/.netlify/functions/workflow" \
  -H 'content-type: application/json' \
  -d '{ "type": "start", "orderId": "netlify-1", "delayMs": 30000 }'

curl "http://localhost:8888/.netlify/functions/timer-sweep"

curl -X POST "http://localhost:8888/.netlify/functions/workflow" \
  -H 'content-type: application/json' \
  -d '{ "type": "payment", "runId": "fulfillment:netlify-1", "paymentId": "pay-netlify-1" }'
```

## What to verify

- Scheduled functions are only wake-up ticks.
- The run survives between invocations because the `RunStore` is external.
- Payment delivery is idempotent when the same `paymentId` is reused.
