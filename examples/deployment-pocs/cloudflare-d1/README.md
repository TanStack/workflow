# Cloudflare D1 Workflow POC

This demo validates TanStack Workflow with:

- Cloudflare Workers HTTP routes
- Cloudflare Cron Triggers
- Cloudflare D1 as the durable `WorkflowExecutionStore`
- package-owned Workflow store migrations

It uses the runtime/store path:

```ts
createCloudflareD1WorkflowStore({ db: env.WORKFLOW_DB })
defineWorkflowRuntime({ store, workflows })
createCloudflareWorkflowScheduledHandler({ runtime })
```

## Routes

- `POST /runs`: start a fulfillment workflow.
- `GET /runs`: list stored runs.
- `GET /runs/:runId`: read a run timeline.
- `POST /signals/payment`: deliver `payment-received`.
- `POST /sweep`: manually run a bounded sweep.
- Cron Trigger: runs the same bounded sweep once per minute.

## D1 setup

Create a D1 database:

```bash
pnpm dlx wrangler d1 create tanstack-workflow-d1-poc
```

Copy the returned `database_id` into `wrangler.toml`.

The D1 binding uses `migrations_dir = "migrations"`. The demo migration is a
copy of the package-owned artifact from:

```txt
packages/workflow-store-cloudflare-d1/migrations/0000_workflow_store.sql
```

Apply it locally:

```bash
pnpm migrate:local
```

Apply it remotely before deployment:

```bash
pnpm migrate:remote
```

Cloudflare documents D1 migrations as Wrangler-managed SQL files, and
`migrations_dir` can be configured per D1 binding.

## Local run

```bash
pnpm install
pnpm dev
```

Start a run:

```bash
curl -X POST "http://localhost:8787/runs" \
  -H 'content-type: application/json' \
  -d '{ "orderId": "d1-1", "delayMs": 30000 }'
```

Sweep after the delay:

```bash
curl -X POST "http://localhost:8787/sweep"
```

Deliver payment:

```bash
curl -X POST "http://localhost:8787/signals/payment" \
  -H 'content-type: application/json' \
  -d '{ "runId": "d1-fulfillment:d1-1", "paymentId": "pay-d1-1" }'
```

Inspect the timeline:

```bash
curl "http://localhost:8787/runs/d1-fulfillment%3Ad1-1"
```

## Deploy

```bash
pnpm migrate:remote
pnpm deploy
```

If `CRON_SECRET` is configured, `POST /sweep` requires:

```http
Authorization: Bearer <CRON_SECRET>
```

Cron Triggers still call the Worker `scheduled()` handler directly.
