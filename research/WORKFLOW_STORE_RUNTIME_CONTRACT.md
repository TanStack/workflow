# Durable execution store and runtime contract RFC

TanStack.com Intent sync exposed the next boundary for TanStack Workflow. The
engine can model the workload, but using `@tanstack/workflow-core` directly in a
serverless app pushes runtime concerns into application code:

- schedule parsing
- deterministic schedule buckets
- deterministic run IDs
- durable store wiring
- event collection
- host-specific invocation handlers
- leases and stale run recovery
- timer wake-ups
- signal delivery
- recent run/admin visibility

Those are not domain concerns. They belong in a durable execution store contract,
a runtime layer, and host adapters.

This RFC captures the direction. It is intentionally not a Drizzle RFC. Drizzle
is a useful first/default SQL implementation, but the core abstraction should be
storage semantics, not an ORM.

## Position

Good:

```ts
const store = createDrizzleWorkflowStore({ db })
```

Risky:

```ts
// The engine is conceptually Drizzle-backed.
```

Best:

```ts
const runtime = defineWorkflowRuntime({
  workflows,
  store,
})
```

The engine has a durable execution store interface. Drizzle/Postgres is the
first friendly implementation of that interface.

## Layers

### `@tanstack/workflow-core`

The existing closure engine:

- `createWorkflow`
- `runWorkflow`
- replay of append-only events
- `ctx.step`, `ctx.sleep`, `ctx.waitForEvent`, `ctx.approve`
- version routing
- minimal `RunStore` for append/replay

This package should stay small and scheduler-agnostic.

### `@tanstack/workflow-runtime`

The deployment-independent runtime:

- workflow registry
- schedule declarations
- deterministic schedule buckets
- deterministic run IDs
- bounded execution slices
- event draining
- timer resume
- signal delivery
- lease and stale run recovery
- run/query helpers for admin UI

### Store packages

Implement the durable execution contract:

- `@tanstack/workflow-store-postgres`
- `@tanstack/workflow-store-drizzle`
- `@tanstack/workflow-store-neon`
- `@tanstack/workflow-store-libsql`
- `@tanstack/workflow-store-redis`
- `@tanstack/workflow-store-cloudflare-d1`

The exact package split can change. The important part is that every store
implements the same behavioral contract.

### Host adapters

Thin host-specific entrypoints:

- `@tanstack/workflow-adapter-netlify`
- `@tanstack/workflow-adapter-vercel`
- `@tanstack/workflow-adapter-cloudflare`

Adapters translate host wake-up mechanisms into runtime calls. They should not
own durability.

## Contract shape

The current `RunStore` in core is enough for append/replay:

```ts
interface RunStore {
  getRunState(runId: string): Promise<RunState | undefined>
  setRunState(runId: string, state: RunState): Promise<void>
  deleteRun(runId: string, reason: DeleteReason): Promise<void>
  appendEvent(
    runId: string,
    expectedNextIndex: number,
    event: WorkflowEvent,
  ): Promise<void>
  getEvents(runId: string): Promise<ReadonlyArray<WorkflowEvent>>
  subscribe?(...)
}
```

Production adapters need a richer execution contract around that primitive.
Proposed direction:

```ts
interface WorkflowExecutionStore {
  // Run creation/loading
  createRun(args: CreateRunArgs): Promise<CreateRunResult>
  loadRun(runId: string): Promise<WorkflowExecution | undefined>
  loadExecution(runId: string): Promise<LoadedExecution | undefined>

  // Event log
  appendEvents(args: AppendEventsArgs): Promise<AppendEventsResult>
  readEvents(args: ReadEventsArgs): Promise<ReadonlyArray<StoredWorkflowEvent>>

  // Leasing/execution
  claimRun(args: ClaimRunArgs): Promise<ClaimRunResult>
  heartbeatRunLease(args: HeartbeatRunLeaseArgs): Promise<void>
  releaseRunLease(args: ReleaseRunLeaseArgs): Promise<void>
  markRunPaused(args: MarkRunPausedArgs): Promise<void>
  markRunFinished(args: MarkRunFinishedArgs): Promise<void>
  markRunErrored(args: MarkRunErroredArgs): Promise<void>

  // Wake-ups
  scheduleTimer(args: ScheduleTimerArgs): Promise<void>
  claimDueTimers(args: ClaimDueTimersArgs): Promise<ReadonlyArray<TimerWakeup>>
  deliverSignal(args: DeliverSignalArgs): Promise<DeliverSignalResult>

  // Schedules
  upsertSchedule(args: UpsertScheduleArgs): Promise<void>
  claimDueScheduleBuckets(
    args: ClaimDueScheduleBucketsArgs,
  ): Promise<ReadonlyArray<ScheduleBucket>>
  markScheduleBucketStarted(args: MarkScheduleBucketStartedArgs): Promise<void>

  // Recovery and admin visibility
  claimStaleRuns(args: ClaimStaleRunsArgs): Promise<ReadonlyArray<RunClaim>>
  listRuns(args: ListRunsArgs): Promise<ReadonlyArray<RunSummary>>
  getRunTimeline(runId: string): Promise<RunTimeline>
}
```

This is not a final API. It names the responsibilities that cannot live in
application code if adapters are going to feel good.

## Required guarantees

Every implementation must provide:

- deterministic run creation for caller-supplied run IDs
- append-only event log
- ordered replay by event index
- compare-and-swap append by expected next event index
- durable step output before proceeding
- idempotent signal delivery by signal ID
- claim/lease semantics for active execution
- indexed due-work queries
- timer indexes by wake time
- stale lease recovery
- queryable run status for operators/admin UI

SQL stores may use row locks, `FOR UPDATE SKIP LOCKED`, advisory locks, or lease
columns. Redis-like stores may use atomic scripts. D1/libSQL implementations may
need a more conservative lease strategy. Those are adapter details; the contract
is the important part.

## Suggested SQL shape

Baseline relational model:

```sql
workflow_runs
  run_id primary key
  workflow_id
  workflow_version
  status
  input jsonb
  output jsonb
  error jsonb
  waiting_for jsonb
  pending_approval jsonb
  wake_at
  lease_owner
  lease_expires_at
  created_at
  updated_at

workflow_run_events
  run_id
  event_index
  event_type
  step_id
  event jsonb
  created_at

  primary key (run_id, event_index)

workflow_schedules
  schedule_id primary key
  workflow_id
  cron
  timezone
  overlap_policy
  next_fire_at
  enabled
  updated_at

workflow_schedule_buckets
  schedule_id
  bucket_id
  run_id
  fire_at
  status
  lease_owner
  lease_expires_at
  created_at
  updated_at

  primary key (schedule_id, bucket_id)

workflow_signal_deliveries
  run_id
  signal_id
  signal_name
  payload jsonb
  delivered_at

  primary key (run_id, signal_id)
```

The event table remains the replay source of truth. The run, schedule, bucket,
and signal tables are queryable coordination/read models.

## Runtime API direction

```ts
export const workflowRuntime = defineWorkflowRuntime({
  workflows: [intentDiscoverWorkflow, intentProcessWorkflow],
  store,
})
```

Scheduled workflow definitions should keep cadence near the workflow without
making the workflow body know it is scheduled:

```ts
export const intentProcessWorkflow = defineScheduledWorkflow({
  id: 'intent-process',
  schedule: every.minutes(15),
  overlapPolicy: 'skip',

  async run(ctx) {
    const versions = await ctx.step('select-pending-versions', () =>
      selectPendingIntentVersions({ limit: 50 }),
    )

    for (const version of versions) {
      await ctx.step(`process-version:${version.id}`, () =>
        processIntentVersion(version.id),
      )
    }
  },
})
```

The workflow owns:

- workflow ID
- schedule declaration
- step IDs
- retry/timeout policy
- domain function calls
- domain idempotency

The runtime owns:

- run IDs
- bucket IDs
- executing a bounded slice
- draining events
- interpreting paused/timer/signal states
- recovery behavior

## Step granularity rule

The Intent sync POC exposed a useful product rule:

> A step is the largest unit of work you are willing to retry from the beginning.

Bad:

```ts
await ctx.step('process-entire-queue', () => processUntilTimeout())
```

Better:

```ts
const work = await ctx.step('claim-work', claimWork)

for (const item of work) {
  await ctx.step(`process-item:${item.id}`, () => processItem(item.id))
}
```

The domain queue remains the domain source of truth. The workflow log records
orchestration progress. Neither should pretend to be the other.

For TanStack.com Intent sync:

- `intent_package_versions.sync_status` remains business state.
- Workflow events record which discovery and processing steps completed.
- Failed package/version work remains visible and retryable in the domain table.

## Serverless execution model

Serverless hosts are bounded executors. They are not durable workflow processes.

Every step should fit inside a single host invocation. The whole workflow can be
long-running because the runtime can yield between steps and continue later.

Future ctx/runtime surface:

```ts
if (ctx.deadline.remainingMs < 30_000) {
  await ctx.continueLater()
}
```

Open question: whether `continueLater` belongs on workflow ctx, runtime ctx, or
only inside adapter-driven execution. The behavior should be:

1. persist all events up to the current boundary
2. release/extend lease intentionally
3. enqueue or expose ready work
4. return from the host invocation

Application code should not hand-roll timeout budgeting.

## Code loading, bundling, and external callers

The runtime contract also needs a code-loading story. A workflow definition is
code, not data. It cannot be serialized into the store or safely invoked by
importing an arbitrary closure from another project at runtime.

The store should persist stable identifiers:

- workflow ID
- workflow version
- run ID
- input payload
- signal/approval payloads
- event log

The runtime should resolve those identifiers to executable code through an
explicit registry:

```ts
export const workflowRuntime = defineWorkflowRuntime({
  workflows: {
    'intent-discover': {
      load: () => import('./workflows/intent-discover'),
    },
    'intent-process': {
      load: () => import('./workflows/intent-process'),
    },
  },
  store,
})
```

That lets adapters avoid bundling every workflow into every entrypoint. A Netlify
sweep function can load only the workflows it needs for due work. A Vercel queue
consumer can load the workflow named by the message/run record. A long-running
worker can preload everything if startup cost matters less than steady-state
latency.

Bundlers and hosts complicate this:

- Many serverless bundlers need statically analyzable imports.
- Some hosts need build-time config for cron routes/functions.
- Dynamic `import()` paths may pull too much code or fail to include modules.
- Previous workflow versions must remain loadable until in-flight runs drain.

So the runtime likely needs a build-time manifest path in addition to a runtime
API:

```ts
// workflow.manifest.ts - generated or hand-authored
export const workflowManifest = {
  workflows: {
    'intent-process': {
      version: '2026-05-26',
      load: () => import('./workflows/intent-process.v2026-05-26'),
      previousVersions: {
        '2026-05-01': () => import('./workflows/intent-process.v2026-05-01'),
      },
    },
  },
  schedules: [
    {
      workflowId: 'intent-process',
      schedule: '*/15 * * * *',
      timezone: 'UTC',
      overlapPolicy: 'skip',
    },
  ],
}
```

Host adapters can consume that manifest to generate or validate:

- Netlify scheduled functions/config
- Vercel cron routes/config
- queue consumers
- signal/webhook routes
- type-safe clients

Type safety has two modes:

1. Closed-loop TypeScript: callers import the workflow definition or generated
   client from the same repo/monorepo and get inferred input/output/signal types.
2. Open-boundary callers: callers use a generated contract artifact based on
   workflow IDs, versions, and Standard Schema-compatible input/output/signal
   schemas.

External callers should not need workflow code in their bundle. They should call
a stable data-plane API:

```ts
await workflows.start('intent-process', {
  runId: 'intent-process:2026-05-26T10:15Z',
  input: { triggeredAt: '2026-05-26T10:15:00.000Z' },
})

await workflows.signal({
  runId,
  signalId: `approval:${approvalId}`,
  name: 'approval-received',
  payload: { approved: true },
})
```

The local app/runtime validates payloads against schemas before execution.
Generated clients can preserve TS ergonomics for first-party apps, while HTTP,
OpenAPI/JSON Schema, or package-published contract files preserve correctness for
non-TS callers.

This keeps the portability claim honest:

- Workflow code runs where the workflow is deployed.
- External systems send data, not closures.
- Bundling is controlled by explicit workflow loaders/manifests.
- Type safety is inferred locally and generated across boundaries.

## Wake-up paths

Adapters need three wake-up paths:

1. Scheduled wake-up: cron/sweep starts due schedule buckets.
2. Timer wake-up: sweep resumes runs whose `wake_at` is due.
3. External wake-up: HTTP/webhook/admin action delivers a signal or approval.

All three converge on the same runtime:

```ts
await runtime.sweep()
await runtime.deliverSignal({ runId, signalId, name, payload })
await runtime.resumeDueTimers()
```

Queue systems can improve latency and fanout, but queues are delivery
mechanisms, not durability. The store remains truth.

## Netlify adapter target

Netlify does not have a native workflow control plane. A good adapter can use one
scheduled sweep function:

```ts
export default createNetlifyWorkflowSweepHandler(workflowRuntime)

export const config = {
  schedule: '*/5 * * * *',
}
```

The sweep should:

1. claim due scheduled workflow buckets
2. claim due timers
3. claim stale/runnable work
4. execute bounded workflow slices
5. release leases or enqueue continuations

Open Netlify questions:

- Does dynamic `export const config = workflow.netlifyConfig` survive static
  analysis?
- Do adapters need code generation for host config?
- How should background function limits feed into deadline-aware continuation?

## Vercel adapter target

Without depending on Vercel's Workflow product, a Vercel adapter likely uses
Vercel Cron plus Vercel Queues when available:

```ts
export const maxDuration = 800

export const GET = createVercelWorkflowSweepHandler(workflowRuntime)
export const POST = createVercelWorkflowSignalHandler(workflowRuntime)
```

Config:

```json
{
  "crons": [
    {
      "path": "/api/workflows",
      "schedule": "*/5 * * * *"
    }
  ]
}
```

The more native version:

- cron sweep finds due work
- queue messages deliver run/resume work
- queue dedupe key uses run ID plus continuation metadata
- queue consumer drives one bounded slice
- DB/store remains the source of truth

## Drizzle posture

Drizzle should be the friendly default, not the conceptual foundation.

Why it is useful:

- self-hosted users
- Postgres-first apps
- local/dev workflows
- simple deployment story
- "bring your own database" credibility

Why it should not define the core:

- atomic claiming/leases
- skip-locked queues
- idempotency keys
- append-only event logs
- timer indexes
- advisory locks or lease heartbeats
- high-volume polling/fanout
- migration-sensitive schema changes
- transaction isolation guarantees

The first implementation can be Drizzle/Postgres if that is the fastest way to
dogfood TanStack.com, but the RFC/API should be written against
`WorkflowExecutionStore`.

## Migration path from today's core

1. Keep the current `RunStore` unchanged for `@tanstack/workflow-core`.
2. Define the richer execution store contract in a new runtime package.
3. Implement an adapter that wraps an execution store as the current core
   `RunStore` for `runWorkflow`.
4. Move schedule/timer/signal/lease logic into runtime helpers.
5. Add one production store implementation.
6. Add Netlify adapter.
7. Redo the TanStack.com Intent sync POC against the runtime/adapter API.

This avoids destabilizing the existing engine while still making room for real
deployment concerns.

## Open questions

- Should `WorkflowExecutionStore` be one interface or several narrower
  capabilities?
- Should schedules be stored by the runtime or generated from code at build time?
- What overlap policies ship first: `skip`, `allow`, `buffer-one`, `cancel`,
  `terminate`?
- Is step-level distributed execution in scope, or does the runtime claim runs
  and execute bounded slices?
- Is the workflow manifest hand-authored, generated, or both?
- What contract format should external callers consume: generated TS package,
  OpenAPI, JSON Schema, Standard Schema metadata, or all of the above?
- How strict should adapters be about statically analyzable workflow loaders?
- How much admin visibility belongs in the store package versus devtools?
- What is the minimum store feature set for Netlify/Vercel MVP?
- How do we expose deadline/yield semantics without making workflow code
  host-aware?

## Recommendation

The next artifact should be a storage/runtime contract prototype, not a Drizzle
adapter PR.

Suggested order:

1. Write `WorkflowExecutionStore` and runtime types.
2. Implement an in-memory execution store for tests.
3. Implement Drizzle/Postgres as the first real store.
4. Build `defineWorkflowRuntime` with sweep/signal/timer helpers.
5. Build the Netlify adapter.
6. Dogfood TanStack.com Intent sync again.

That keeps the product claim honest: TanStack Workflow is headless and portable,
with Drizzle as a friendly default implementation rather than the foundation.
