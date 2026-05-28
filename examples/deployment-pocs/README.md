# Deployment POCs

These demos validate the headless serverless shape for TanStack Workflow:

1. A workflow invocation runs until it finishes or reaches the next pause.
2. `RunStore` persists state and an append-only event log outside the host.
3. Host cron or alarms wake paused timer runs by delivering `__timer`.
4. Webhooks or HTTP calls resume signal waits with stable `signalId` values.

The demos intentionally avoid `vercelAdapter`, `netlifyAdapter`, or
`cloudflareAdapter` APIs. The reusable pieces are capability adapters in
`shared/src`:

- `workflows.ts`: one long-lived fulfillment workflow and one cron-style digest workflow.
- `http-run-store.ts`: HTTP `RunStore` client used by Vercel and Netlify.
- `upstash-run-store.ts`: Redis-over-HTTP `RunStore` POC with atomic append and a timer index.
- `runtime.ts`: start, attach, signal, due-timer sweep, and scheduled-digest helpers.

## Live deployments

These temporary POCs were deployed on May 25, 2026:

- Cloudflare: <https://tanstack-workflow-cloudflare-poc.tannerlinsley.workers.dev>
- Vercel: <https://deployment-pocs.vercel.app>
- Netlify: <https://tanstack-workflow-netlify-poc.netlify.app>

The live Vercel and Netlify deployments use the Cloudflare Worker's Durable
Object-backed `/store` endpoint as their shared `RunStore`.

## Required storage

The runtime supports two storage options.

Use an HTTP store:

```bash
WORKFLOW_STORE_URL=https://tanstack-workflow-cloudflare-poc.tannerlinsley.workers.dev
WORKFLOW_STORE_TOKEN=optional-shared-secret
```

Or use Redis REST:

```bash
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
WORKFLOW_KEY_PREFIX=workflow-poc
```

For the live POC, the Cloudflare store endpoint was intentionally made public
so Vercel and Netlify could use it without sharing a credential across
providers. This is not the production recommendation; it is only a temporary
deployment shortcut for validating the host experience.

Upstash remains in the source as a portable storage fallback because it works
from Node functions and edge workers via `fetch`. It is a stand-in for a future
storage capability adapter such as Postgres, D1, Durable Object storage, or
another Redis implementation.

## Flow to test

Start a run. It reserves inventory, records a deterministic `now`, and pauses
on `ctx.sleepUntil`.

```bash
curl -X POST "$BASE_URL/workflow" \
  -H 'content-type: application/json' \
  -d '{ "type": "start", "orderId": "order-1", "delayMs": 30000 }'
```

Sweep timers after `delayMs`. The sweeper resumes the run with a stable
`__timer` signal and the workflow pauses again on `payment-received`.

```bash
curl "$BASE_URL/cron/timers"
```

Signal payment. The workflow resumes, ships the order, and finishes.

```bash
curl -X POST "$BASE_URL/workflow" \
  -H 'content-type: application/json' \
  -d '{ "type": "payment", "runId": "fulfillment:order-1", "paymentId": "pay-1" }'
```

Attach at any point to replay the run log without driving it forward.

```bash
curl -X POST "$BASE_URL/workflow" \
  -H 'content-type: application/json' \
  -d '{ "type": "attach", "runId": "fulfillment:order-1" }'
```

The scheduled digest route proves the cron pattern: each tick creates a fresh
workflow run with a deterministic run id for that minute.

```bash
curl "$BASE_URL/cron/digest"
```

## Destinations

- [Vercel](./vercel/README.md): Next route handlers plus Vercel Cron.
- [Netlify](./netlify/README.md): Netlify Functions plus Scheduled Functions.
- [Cloudflare](./cloudflare/README.md): Worker fetch handler plus Cron Triggers.

## What this proves

- The workflow code and runtime helpers stay host-agnostic.
- Serverless execution duration is irrelevant after each pause because the
  JavaScript invocation returns.
- `ctx.sleepUntil` only needs a timer driver that can find due paused runs and
  deliver `__timer`.
- Cron is a fresh workflow invocation per tick, not an infinite workflow loop.

## Current limitations

- The Redis REST store is a POC, not a production package.
- Timer sweeps use a simple due-timer scan without leases. Stable `signalId`
  values make duplicate timer deliveries safe enough for the demo.
- The demos depend on the published `@tanstack/workflow-core` package version.
  When running from this monorepo before publication, point that dependency at
  the local package or include these demos in the workspace.
