---
id: runtime-api
title: Runtime API
---

# Runtime API

`@tanstack/workflow-runtime` provides the deployment-independent execution
runtime.

## `defineWorkflowRuntime`

Registers workflows and returns runtime methods.

```ts
import { defineWorkflowRuntime } from '@tanstack/workflow-runtime'

const runtime = defineWorkflowRuntime({
  store,
  defaultLeaseMs: 30_000,
  telemetry: {
    spanNamePrefix: 'tanstack.workflow',
  },
  workflows: {
    checkout: {
      load: async () => checkoutWorkflow,
      version: 'v2',
      previousVersions: {
        v1: async () => checkoutWorkflowV1,
      },
      schedules: [],
    },
  },
})
```

### Telemetry

Workflow emits OpenTelemetry traces through `@opentelemetry/api`. Applications
own SDK/exporter setup. If no SDK is configured, spans are no-ops.

```ts
const runtime = defineWorkflowRuntime({
  store,
  workflows,
  telemetry: {
    attributes: ({ workflowId, runId }) => ({
      'app.workflow': workflowId ?? 'unknown',
      'app.run': runId ?? 'unknown',
    }),
    mapStepMeta: (meta) => ({
      'app.step_name': String(meta.name),
    }),
  },
})
```

Set `telemetry: false` or `telemetry: { enabled: false }` to disable tracing.

`WorkflowTelemetryOptions`:

| Option | Purpose |
| --- | --- |
| `enabled` | Set false to disable tracing. |
| `tracer` | Custom OpenTelemetry `Tracer`. Defaults to the global tracer provider. |
| `spanNamePrefix` | Prefix for Workflow span names. Defaults to `tanstack.workflow`. |
| `attributes` | Safe shared attributes or a function that returns them per span. |
| `recordExceptions` | Whether to call `span.recordException`. Defaults to true. |
| `mapStepMeta` | Optional mapper for safe `ctx.step(..., { meta })` attributes. |

Workflow never records workflow input, output, signal payloads, step results, or
raw step metadata as attributes by default.

### Workflow registration

| Field | Purpose |
| --- | --- |
| `load` | Async workflow loader. Can return a workflow, `{ default }`, or `{ workflow }`. |
| `version` | Current workflow version for new runs. |
| `previousVersions` | Loaders for old versions that still have paused runs. |
| `schedules` | Registered recurring schedules for this workflow. |

## Runtime deadlines

Every runtime method that can drive workflow code accepts the same budget
options:

| Option | Purpose |
| --- | --- |
| `deadline` | Absolute wall-clock deadline in UTC milliseconds. |
| `maxDurationMs` | Maximum wall-clock duration for this runtime call. |
| `minYieldRemainingMs` | Budget reserved before fresh durable work. Defaults to 1000ms. |

When both deadline forms are present, the earlier deadline wins. The runtime
checks the budget before fresh `step`, `now`, and `uuid` work. A low budget
pauses the run on a durable timer, releases its lease, and lets a later sweep
resume it. Existing `sleep`, `waitForEvent`, and `approve` calls already pause.

Step timeouts remain per-attempt limits and do not use the runtime deadline.

## `runtime.startRun`

Starts or attaches to a run ID through the runtime store.

```ts
const result = await runtime.startRun({
  workflowId: 'checkout',
  runId: 'checkout:order-1',
  input: { orderId: 'order-1' },
  leaseOwner: 'api:checkout',
  leaseMs: 30_000,
  includeEvents: false,
})
```

Options:

| Option | Purpose |
| --- | --- |
| `workflowId` | Registered workflow key. |
| `runId` | Stable run identifier. |
| `input` | Workflow input for new runs. |
| `now` | Override current time for tests or host events. |
| `deadline` | Absolute wall-clock deadline in UTC milliseconds. |
| `maxDurationMs` | Maximum wall-clock duration for this call. |
| `minYieldRemainingMs` | Budget reserved before fresh durable work. |
| `leaseOwner` | Worker identity used while executing. |
| `leaseMs` | Lease duration. |
| `threadId` | Optional core engine thread ID. |
| `includeEvents` | Whether to retain emitted events in the result. Defaults to true. |
| `maxEvents` | Maximum retained events when `includeEvents` is true. |

## `runtime.deliverSignal`

Delivers an external signal and resumes the run.

```ts
await runtime.deliverSignal({
  runId: 'checkout:order-1',
  signalId: 'stripe:evt_123',
  name: 'payment-received',
  payload: { paymentId: 'pi_123' },
})
```

Use stable `signalId` values so webhook retries are idempotent.

## `runtime.deliverApproval`

Delivers an approval decision and resumes the run.

```ts
await runtime.deliverApproval({
  runId,
  approval: {
    approvalId,
    approved: true,
    feedback: 'Approved',
  },
})
```

## `runtime.sweep`

Claims due schedules and timers, then drives them to completion or the next
pause.

```ts
const result = await runtime.sweep({
  now: Date.now(),
  maxScheduledRuns: 25,
  maxTimers: 25,
  maxDurationMs: 55_000,
  leaseOwner: 'cron:sweep',
  leaseMs: 30_000,
  includeEvents: false,
})
```

Options:

| Option | Purpose |
| --- | --- |
| `now` | Current timestamp used for due checks. |
| `limit` | Backward-compatible shared limit for schedules and timers. |
| `maxScheduledRuns` | Maximum due schedule buckets to start. |
| `maxTimers` | Maximum due timers to resume. |
| `deadline` | Absolute wall-clock deadline in UTC milliseconds. |
| `maxDurationMs` | Wall-clock budget for this sweep. |
| `minYieldRemainingMs` | Stops claims and fresh durable work inside this margin. |
| `leaseOwner` | Worker identity for claimed work. |
| `leaseMs` | Lease duration. |
| `includeEvents` | Whether to retain emitted events. Sweeps usually set false. |
| `maxEvents` | Maximum retained events per run result. |

Result:

```ts
interface WorkflowRuntimeSweepResult {
  scheduled: ReadonlyArray<WorkflowRuntimeRunResult>
  timers: ReadonlyArray<WorkflowRuntimeRunResult>
  summary: WorkflowRuntimeSweepSummary
  deadlineReached: boolean
  remainingMayExist: boolean
}
```

`remainingMayExist` means the sweep stopped at a count or time budget, so more
due work may be available.

## `cron`

Creates a cron schedule spec.

```ts
import { cron } from '@tanstack/workflow-runtime'

cron('0 9 * * 1', { timezone: 'UTC' })
```

Current materialization supports numeric five-field UTC cron schedules.

## `every`

Creates interval schedule specs.

```ts
import { every } from '@tanstack/workflow-runtime'

every.seconds(30)
every.minutes(15)
every.hours(1)
```

## `materializeWorkflowSchedules`

Computes due schedule buckets from registered workflow schedules.

```ts
import { materializeWorkflowSchedules } from '@tanstack/workflow-runtime'

const materialized = await materializeWorkflowSchedules(runtime, {
  now: Date.now(),
  cronLookbackMs: 24 * 60 * 60 * 1000,
})
```

Host adapters call this for you before sweeping.

## `inMemoryWorkflowExecutionStore`

Creates an in-memory `WorkflowExecutionStore` for tests and local demos.

```ts
import { inMemoryWorkflowExecutionStore } from '@tanstack/workflow-runtime'

const store = inMemoryWorkflowExecutionStore()
```

Do not use this as production persistence. Memory disappears when the process
exits.

## `createRunStoreAdapter`

Adapts a `WorkflowExecutionStore` to the core engine's `RunStore` interface.

Most users will not call this directly. The runtime driver uses it internally.

## `createRuntimeDriver`

Lower-level helper used by `defineWorkflowRuntime`.

Most users should call `defineWorkflowRuntime`.
