---
title: Runtime API | TanStack Workflow
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

### Workflow registration

| Field | Purpose |
| --- | --- |
| `load` | Async workflow loader. Can return a workflow, `{ default }`, or `{ workflow }`. |
| `version` | Current workflow version for new runs. |
| `previousVersions` | Loaders for old versions that still have paused runs. |
| `schedules` | Registered recurring schedules for this workflow. |

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
| `maxDurationMs` | Wall-clock budget for this sweep. |
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
