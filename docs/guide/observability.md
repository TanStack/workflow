---
id: observability
title: Observability
---

# Observability

TanStack Workflow emits OpenTelemetry traces from the runtime and core engine.
The packages depend only on `@opentelemetry/api`; your application owns the OTel
SDK, exporter, collector, and provider setup.

If no OpenTelemetry SDK is configured, tracing is a no-op.

## What is traced

The runtime creates spans for:

- `tanstack.workflow.start_run`
- `tanstack.workflow.deliver_signal`
- `tanstack.workflow.deliver_approval`
- `tanstack.workflow.sweep`
- `tanstack.workflow.drive_run`

Store calls made by the runtime are traced as child spans, such as
`tanstack.workflow.store.claim_run`,
`tanstack.workflow.store.append_events`, and
`tanstack.workflow.store.claim_due_timers`.

Fresh `ctx.step` executions create `tanstack.workflow.step` spans. Replayed
steps do not create fresh step execution spans because no user step code ran.

## Privacy defaults

Workflow tracing intentionally does not record workflow input, workflow output,
signal payloads, step results, or arbitrary step metadata as attributes.

Built-in attributes are stable identifiers and counts:

- `tanstack.workflow.workflow_id`
- `tanstack.workflow.workflow_version`
- `tanstack.workflow.run_id`
- `tanstack.workflow.operation`
- `tanstack.workflow.result_kind`
- `tanstack.workflow.step_id`
- `tanstack.workflow.signal_name`
- `tanstack.workflow.schedule_id`
- `tanstack.workflow.bucket_id`
- `tanstack.workflow.lease_owner`
- `tanstack.workflow.event_count`
- `tanstack.workflow.events_truncated`

If you want to add safe application attributes, pass `telemetry.attributes` or
`telemetry.mapStepMeta`.

## Configure tracing

Initialize OpenTelemetry in your app before Workflow code runs. Then create the
runtime normally:

```ts
import { defineWorkflowRuntime } from '@tanstack/workflow-runtime'

export const workflowRuntime = defineWorkflowRuntime({
  store,
  workflows,
})
```

Workflow uses the global OpenTelemetry tracer provider by default.

To customize Workflow tracing:

```ts
export const workflowRuntime = defineWorkflowRuntime({
  store,
  workflows,
  telemetry: {
    spanNamePrefix: 'tanstack.workflow',
    attributes: ({ workflowId }) => ({
      'app.workflow_id': workflowId ?? 'unknown',
    }),
    mapStepMeta: (meta) => ({
      'app.step_name': String(meta.name),
    }),
  },
})
```

Only use `mapStepMeta` for metadata you know is safe to export. Workflow does
not export step metadata by default.

Disable tracing for a runtime:

```ts
export const workflowRuntime = defineWorkflowRuntime({
  store,
  workflows,
  telemetry: false,
})
```

## Deployment notes

Host adapters do not need separate tracing configuration. Netlify, Vercel,
Cloudflare, and Railway helpers call `runtime.sweep()`, so they inherit the
runtime spans automatically.

For serverless platforms, initialize the OpenTelemetry SDK in the platform's
recommended instrumentation entrypoint. Workflow only emits spans through the
OpenTelemetry API; exporter flushing and process lifecycle are app concerns.
