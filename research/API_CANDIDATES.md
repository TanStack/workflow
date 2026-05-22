# TanStack Workflow — Top 3 API Design Candidates

> Three concrete API designs, each implementing the same canonical workflow end-to-end. Prioritized for type safety, composable primitives, and platform agnosticism — TanStack's core tenets applied to durable execution.

---

## Design philosophy: the non-negotiables

Every candidate below adheres to the same foundational commitments. The candidates differ only in _how_ they express these.

1. **Type safety is paramount.** Step input/output types are inferred from closures, never declared twice. Event payload types are inferred from schemas. Workflow return types flow through to call sites and React hooks. Zero casts in user code. No `any` leakage at boundaries.
2. **Composable primitives.** `step`, `sleep`, `waitForEvent`, `invoke`, `parallel`, `race`, `compensate` are first-class units. They can be defined once and reused across workflows.
3. **Platform agnosticism.** The workflow _definition_ is decoupled from storage, runtime, and deployment target. Adapters wire the engine to Postgres / SQLite / D1 / Durable Objects / Redis / in-memory at startup. The same definition runs on Vercel, Cloudflare Workers, Fly machines, Bun servers, and Node containers.
4. **Headless / framework-agnostic core.** Pure TS in `@tanstack/workflow-core` with zero framework deps. React / Solid / Vue / Svelte bindings ship as separate packages with `useWorkflow*` hooks.
5. **No decorators, no class-based APIs.** Function-first, like the rest of TanStack.
6. **Standard Schema, observable run streams, updater patterns.** Borrow existing TanStack design language wherever possible.
7. **Auto-versioned executions.** Every run pins to the code SHA that started it; new deploys can't break in-flight workflows.
8. **Storage is the only source of truth.** No in-process workflow→workflow calls. Everything goes through the storage adapter so cross-runtime invocation works.

These eight commitments are settled. The candidates below differ on _how_ they express the workflow, not on what guarantees the engine provides.

---

## The canonical example

To make comparisons concrete, every candidate implements the same workflow. It exercises everything the API needs to cover.

**User onboarding flow:**

1. Load the user's profile (step with typed return)
2. Kick off a child workflow to send onboarding emails (subworkflow invoke, detached)
3. Sleep 24 hours
4. Race up to 7 days for one of: an `approved` event, a `rejected` event, or timeout
5. If approved: charge their card + activate their account, with saga compensation if activate fails
6. If rejected or timed out: mark inactive
7. Return a discriminated-union result the call site can pattern-match against

In TypeScript, the expected signature of the final exported workflow is:

```typescript
type OnboardWorkflow = Workflow<
  // Input
  { userId: string },
  // Output (discriminated union)
  | { status: 'active'; userId: string; by: string; chargeId: string }
  | { status: 'inactive'; userId: string; reason: 'rejected' | 'timed_out' },
  // Events
  { approved: { approverId: string }; rejected: { reason: string } }
>
```

All three candidates must produce a workflow with this inferred shape from the user's code, with zero explicit type annotations beyond schema declarations.

Shared imports for all three candidates:

```typescript
import { z } from 'zod'
import {
  loadProfile, // (userId: string) => Promise<{ id: string; cardId: string; email: string }>
  chargeCard, // (cardId: string, amount: number) => Promise<{ chargeId: string }>
  refundCharge, // (chargeId: string) => Promise<void>
  activateAccount, // (userId: string) => Promise<void>
  markInactive, // (userId: string) => Promise<void>
  sendEmail, // (userId: string, template: 'welcome' | 'day-2' | 'day-7') => Promise<void>
} from '~/integrations'
```

---

# Candidate 1 — Definition-object + ctx primitives

> **The conservative pick.** Most familiar to TanStack users. Mirrors `useQuery({ queryKey, queryFn })`, `createCollection({...})`, `createRoute({...})`. Lowest implementation risk. Ships first, debuggable, no build-toolchain dependency.

## Shape

A workflow is a definition object passed to `createWorkflow()`. The `run` function receives a `ctx` object exposing every durable primitive as a method. Step identity comes from explicit string labels (with an optional build transform that derives them from lexical position).

## Hello world

```typescript
import { createWorkflow } from '@tanstack/workflow'

export const hello = createWorkflow({
  name: 'hello',
  run: async (ctx, input: { name: string }) => {
    await ctx.step('greet', () => console.log(`hi, ${input.name}`))
    return { greeted: input.name }
  },
})
```

The exported `hello` is both the definition and the typed handle. No registration step, no class, no decorator.

## Subworkflow

```typescript
const emailSeries = createWorkflow({
  name: 'email-series',
  input: z.object({ userId: z.string() }),
  run: async (ctx, { userId }) => {
    await ctx.step('welcome', () => sendEmail(userId, 'welcome'))
    await ctx.sleep('to-day-2', '1d')
    await ctx.step('day-2', () => sendEmail(userId, 'day-2'))
    await ctx.sleep('to-day-7', '5d')
    await ctx.step('day-7', () => sendEmail(userId, 'day-7'))
  },
})
```

## Reusable step primitive

```typescript
import { defineStep } from '@tanstack/workflow'

const charge = defineStep({
  name: 'charge-card',
  retries: 5,
  backoff: { kind: 'exponential', baseMs: 1000, maxMs: 60_000 },
  run: async (cardId: string, amount: number) => chargeCard(cardId, amount),
  //                                              ^? returns { chargeId: string }
  compensate: async (result) => refundCharge(result.chargeId),
})
```

`charge` is callable as `charge(ctx, cardId, amount)` — explicit ctx threading. It carries its retry policy, name, and compensation logic with it.

## Full onboarding workflow

```typescript
export const onboard = createWorkflow({
  name: 'onboard',
  input: z.object({ userId: z.string() }),
  events: {
    approved: z.object({ approverId: z.string() }),
    rejected: z.object({ reason: z.string() }),
  },
  retries: 2,
  timeout: '14d',
  run: async (ctx, { userId }) => {
    const profile = await ctx.step('load-profile', () => loadProfile(userId))
    //    ^? { id: string; cardId: string; email: string }

    await ctx.invoke(emailSeries, { userId }, { detached: true })

    await ctx.sleep('cooldown', '1d')

    const decision = await ctx.race(
      {
        approved: ctx.waitForEvent('approved'),
        rejected: ctx.waitForEvent('rejected'),
      },
      { timeout: '7d' },
    )
    //    ^? { type: 'approved'; data: { approverId: string } }
    //     | { type: 'rejected'; data: { reason: string } }
    //     | { type: 'timeout' }

    if (decision.type === 'approved') {
      const result = await ctx.saga(async (s) => {
        const c = await s.step(charge, profile.cardId, 999)
        //    ^? { chargeId: string }
        const a = await s.step('activate', () => activateAccount(userId))
        return { c, a }
      })
      return {
        status: 'active' as const,
        userId,
        by: decision.data.approverId,
        chargeId: result.c.chargeId,
      }
    }

    await ctx.step('mark-inactive', () => markInactive(userId))
    return {
      status: 'inactive' as const,
      userId,
      reason:
        decision.type === 'rejected'
          ? ('rejected' as const)
          : ('timed_out' as const),
    }
  },
})
```

## Inferred type at call site

```typescript
const handle = await workflow.start(onboard, { userId: '123' })
//    ^? WorkflowHandle<
//         | { status: 'active'; userId: string; by: string; chargeId: string }
//         | { status: 'inactive'; userId: string; reason: 'rejected' | 'timed_out' }
//       >

const result = await handle.result()
//    ^? same discriminated union
if (result.status === 'active') {
  console.log(result.chargeId) //  type-narrowed
  console.log(result.reason) //  TS error
}
```

Events are typed at the publish call site:

```typescript
await workflow.publish(
  onboard.events.approved,
  { approverId: 'admin-7' },
  { runId },
)
//                                              ^^^ payload type checked against the schema
```

## React binding

```typescript
import { useWorkflowRun, useWorkflowStream } from '@tanstack/react-workflow'
import { onboard } from '~/workflows/onboard'

function OnboardingStatus({ runId }: { runId: string }) {
  const run = useWorkflowRun(onboard, runId)
  //    ^? UseWorkflowRunResult<
  //         | { status: 'active'; ... }
  //         | { status: 'inactive'; ... }
  //       >

  if (run.state === 'running' && run.currentStep === 'load-profile') {
    return <Loading />
  }
  if (run.state === 'completed' && run.result.status === 'active') {
    return <ActiveBadge by={run.result.by} />
  }
  if (run.state === 'failed') return <Error err={run.error} />
  return null
}
```

A streaming variant for live updates:

```typescript
function LiveProgress({ runId }: { runId: string }) {
  const stream = useWorkflowStream(onboard, runId)
  //    ^? events stream — typed step transitions, event arrivals, completions
  return <StepTimeline steps={stream.events} />
}
```

## Engine wiring (platform agnosticism)

```typescript
// workflow.server.ts — Production: Vercel + Neon
import { createEngine } from '@tanstack/workflow'
import { postgresStorage } from '@tanstack/workflow-postgres'
import { cronRuntime } from '@tanstack/workflow-cron'
import { onboard, emailSeries } from './workflows'

export const workflow = createEngine({
  storage: postgresStorage({ client: neonClient }),
  runtime: cronRuntime({ batchSize: 50, budgetMs: 25_000 }),
  workflows: [onboard, emailSeries],
})

// Same workflows, Cloudflare DO:
export const workflow = createEngine({
  storage: durableObjectStorage({ binding: env.WORKFLOW_DO }),
  runtime: durableObjectRuntime(),
  workflows: [onboard, emailSeries],
})

// Same workflows, in-memory for dev/test:
export const workflow = createEngine({
  storage: memoryStorage(),
  runtime: memoryRuntime(),
  workflows: [onboard, emailSeries],
})
```

The workflow definitions don't change. Only the engine adapters do.

## How types flow through this design

```
input schema         ───►  ctx.run's second arg
                                 │
                                 ▼
events schema map    ───►  ctx.waitForEvent('name') return type
                                 │
                                 ▼
step closure return  ───►  await ctx.step('name', fn) return type
                                 │
                                 ▼
run() return type    ───►  Workflow<TIn, TOut, TEvents>
                                 │
                                 ▼
                          WorkflowHandle<TOut>
                                 │
                                 ▼
                          useWorkflowRun().result
```

Every layer infers from the layer above. Zero manual generic specification by the user.

## Composable primitive: `defineStep`

```typescript
type StepDef<TArgs extends any[], TReturn> = {
  name: string
  retries?: number
  backoff?: BackoffPolicy
  timeout?: Duration
  run: (...args: TArgs) => Promise<TReturn>
  compensate?: (result: TReturn) => Promise<void>
}

function defineStep<TArgs extends any[], TReturn>(
  def: StepDef<TArgs, TReturn>,
): (ctx: WorkflowContext, ...args: TArgs) => Promise<TReturn>
```

A defined step is a function that takes ctx as the first arg. This is the explicit form. Composability is good — you can extract any step into a reusable primitive — but every caller has to thread ctx through.

## Pros and cons

**Pros:**

- Most TanStack-familiar (definition-object pattern from Query, DB, Router, Form)
- All inference flows through a single object — easy to reason about
- Stack traces are clean — `ctx.step` calls appear by name
- No build-tool dependency required
- Easy to test — `run` is just a function
- Easy to migrate to from Inngest (very similar API)
- Adapter pattern is straightforward

**Cons:**

- String labels are a footgun — `ctx.step('charge', ...)` → rename to `'charge-card'` and in-flight runs break
- `ctx` parameter must thread through every helper function — composability tax
- `ctx.step('name', fn)` is verbose compared to `step(fn)`
- The repetition of step names in code adds visual noise

**Mitigations:**

- Optional `@tanstack/workflow-vite` / SWC / esbuild plugin that derives step IDs from lexical position at build time, allowing `ctx.step(fn)` without the label
- `defineStep` carries the name so reusable primitives don't repeat it
- Runtime check: if a workflow tries to call an unknown step during replay, throw a clear "Workflow non-determinism" error pointing to the missing step

---

# Candidate 2 — Builder chain with middleware

> **The TanStack Start-shaped pick.** Mirrors `createServerFn().validator().middleware().handler()`. Brings _middleware composition_ as a first-class concern — workflows are recipes built up incrementally with reusable middleware that can extend the context, add observability, enforce auth, or inject dependencies. Each method call narrows types.

## Shape

A workflow is built by chaining typed methods. Each call returns a more-narrowly-typed builder. The chain ends with `.handler()` which seals the workflow. The distinctive feature: `.middleware()` and `.use()` for composing cross-cutting concerns into the workflow's context.

## Hello world

```typescript
import { createWorkflow } from '@tanstack/workflow'

export const hello = createWorkflow()
  .name('hello')
  .input(z.object({ name: z.string() }))
  .handler(async (ctx, { name }) => {
    await ctx.step('greet', () => console.log(`hi, ${name}`))
    return { greeted: name }
  })
```

## Reusable middleware

This is the distinctive primitive in Candidate 2 — middleware that wraps the workflow with cross-cutting behavior and can extend `ctx`:

```typescript
import { createMiddleware } from '@tanstack/workflow'

// Add auth context — narrows ctx to require it downstream
const requireUser = createMiddleware().handler(async ({ ctx, next, input }) => {
  const user = await ctx.step('load-user', () => loadProfile(input.userId))
  return next({ ctx: { ...ctx, user } })
})

// Add tracing — wraps every step in a span
const traced = createMiddleware().handler(async ({ ctx, next }) => {
  const tracer = ctx.tracer.startWorkflow(ctx.workflowName, ctx.runId)
  try {
    return await next({ ctx: { ...ctx, tracer } })
  } finally {
    tracer.end()
  }
})

// Add structured logging
const logged = createMiddleware().handler(async ({ ctx, next }) => {
  ctx.logger.info('workflow.start', { runId: ctx.runId })
  const result = await next({ ctx })
  ctx.logger.info('workflow.complete', { runId: ctx.runId })
  return result
})
```

## Reusable step primitive (same as Candidate 1)

```typescript
const charge = defineStep({
  name: 'charge-card',
  retries: 5,
  backoff: { kind: 'exponential', baseMs: 1000 },
  run: async (cardId: string, amount: number) => chargeCard(cardId, amount),
  compensate: async (result) => refundCharge(result.chargeId),
})
```

## Subworkflow

```typescript
const emailSeries = createWorkflow()
  .name('email-series')
  .input(z.object({ userId: z.string() }))
  .middleware(traced)
  .handler(async (ctx, { userId }) => {
    await ctx.step('welcome', () => sendEmail(userId, 'welcome'))
    await ctx.sleep('to-day-2', '1d')
    await ctx.step('day-2', () => sendEmail(userId, 'day-2'))
    await ctx.sleep('to-day-7', '5d')
    await ctx.step('day-7', () => sendEmail(userId, 'day-7'))
  })
```

## Full onboarding workflow

```typescript
export const onboard = createWorkflow()
  .name('onboard')
  .input(z.object({ userId: z.string() }))
  .event('approved', z.object({ approverId: z.string() }))
  .event('rejected', z.object({ reason: z.string() }))
  .retries(2)
  .timeout('14d')
  .middleware(logged)
  .middleware(traced)
  .middleware(requireUser) // adds ctx.user; downstream gets typed access
  .handler(async (ctx, { userId }) => {
    // ctx.user is now typed thanks to requireUser middleware
    const profile = ctx.user
    //    ^? { id: string; cardId: string; email: string }

    await ctx.invoke(emailSeries, { userId }, { detached: true })

    await ctx.sleep('cooldown', '1d')

    const decision = await ctx.race(
      {
        approved: ctx.waitForEvent('approved'),
        rejected: ctx.waitForEvent('rejected'),
      },
      { timeout: '7d' },
    )

    if (decision.type === 'approved') {
      const result = await ctx.saga(async (s) => {
        const c = await s.step(charge, profile.cardId, 999)
        const a = await s.step('activate', () => activateAccount(userId))
        return { c, a }
      })
      return {
        status: 'active' as const,
        userId,
        by: decision.data.approverId,
        chargeId: result.c.chargeId,
      }
    }

    await ctx.step('mark-inactive', () => markInactive(userId))
    return {
      status: 'inactive' as const,
      userId,
      reason:
        decision.type === 'rejected'
          ? ('rejected' as const)
          : ('timed_out' as const),
    }
  })
```

## Type narrowing through the chain

Each method call adds to the builder's type signature. The handler at the end sees the full accumulated shape:

```typescript
declare const onboard: WorkflowBuilder<
  // Input
  { userId: string },
  // Events
  { approved: { approverId: string }; rejected: { reason: string } },
  // Context extensions accumulated from middleware
  { user: { id: string; cardId: string; email: string } }
>
```

After `.handler(fn)` it becomes:

```typescript
declare const onboard: Workflow<
  { userId: string },
  | { status: 'active'; userId: string; by: string; chargeId: string }
  | { status: 'inactive'; userId: string; reason: 'rejected' | 'timed_out' },
  { approved: { approverId: string }; rejected: { reason: string } }
>
```

## Middleware composition pattern

The big idea: reusable workflow _layers_ you compose into specific workflows. This becomes huge for organization-wide concerns:

```typescript
// Define once, reuse everywhere
export const orgConventions = compose(
  logged,
  traced,
  requireUser,
  withFeatureFlags,
)

// Apply to many workflows
export const onboard = createWorkflow()
  .name('onboard')
  .middleware(orgConventions)
// ... rest

export const offboard = createWorkflow()
  .name('offboard')
  .middleware(orgConventions)
// ... rest
```

This is functionally equivalent to `createServerFn` + middleware patterns in TanStack Start — the user gets a feeling of familiarity.

## Engine wiring (identical to Candidate 1)

```typescript
export const workflow = createEngine({
  storage: postgresStorage({ client: pool }),
  runtime: cronRuntime({ batchSize: 50 }),
  workflows: [onboard, emailSeries],
})
```

## Pros and cons

**Pros:**

- Middleware composition is a first-class, distinctive primitive — no other workflow library does this cleanly
- Mirrors TanStack Start's `createServerFn` patterns, so devs already in the TanStack ecosystem feel at home
- Incremental type narrowing makes the chain self-documenting
- Cross-cutting concerns (auth, tracing, logging, feature flags) compose naturally
- The chain's terminal `.handler()` enforces a clear "done building" boundary
- No build transform required

**Cons:**

- Verbose — every workflow definition is several method calls deep
- Type narrowing through deep chains can be slow on the TS compiler (Effect-style chains have this problem at scale)
- The "middleware extends ctx" pattern is powerful but has a learning curve
- Same string-label step ID footgun as Candidate 1
- Step-level composability is still tied to explicit ctx threading
- Refactoring a workflow (reordering middleware) can shift ctx shape in non-obvious ways

**Where it wins:** Organizations with shared cross-cutting concerns (auth, tracing, feature flags) and a desire for consistent workflow patterns across many definitions. Startup teams will love this; library users will love this.

**Where it loses:** Solo devs writing small workflows feel the ceremony. Single-file scripts feel over-engineered.

---

# Candidate 3 — Implicit context, hooks-inspired primitives

> **The DX bet.** Build-time AST transform threads context implicitly via AsyncLocalStorage. Primitives are imported functions called directly inside a workflow body — no `ctx` parameter, no string labels. Step identity comes from lexical AST position. Highest composability, lowest boilerplate, biggest implementation investment.

## Shape

A workflow is a plain async function passed to `workflow()`. Inside the body, you call imported primitives (`step`, `sleep`, `waitForEvent`, `invoke`) directly. The build transform inserts a stable identity into each call site based on the AST position; the runtime uses AsyncLocalStorage to provide the workflow context to each primitive. Without the transform, the runtime falls back to source-position via `Error.stack` (slower; explicit IDs always available as escape hatch).

This is the most "TanStack Query hooks"-feeling design: primitives compose like hooks, but for durable execution.

## Hello world

```typescript
import { workflow, step } from '@tanstack/workflow'

export const hello = workflow(async (input: { name: string }) => {
  await step(() => console.log(`hi, ${input.name}`))
  return { greeted: input.name }
})
```

That's the entire program. No name, no schema, no ctx parameter. The build transform inserts step identity. The runtime infers the workflow name from the export name (or file path) — overridable via the second argument.

## With explicit options

```typescript
export const hello = workflow(
  async (input: { name: string }) => {
    await step(() => console.log(`hi, ${input.name}`))
    return { greeted: input.name }
  },
  { name: 'hello', retries: 3, timeout: '1m' },
)
```

## Reusable step primitive

The killer feature: a step _is just a function_. You write a normal async function that uses `step()` internally; callers invoke it like any other function. Context is threaded via AsyncLocalStorage. No ctx threading. No boilerplate.

```typescript
import { step, defineStep } from '@tanstack/workflow'

// Inline composition — just write a function
async function chargeWithRetry(cardId: string, amount: number) {
  return step(() => chargeCard(cardId, amount), {
    retries: 5,
    backoff: { kind: 'exponential', baseMs: 1000 },
    compensate: (r) => refundCharge(r.chargeId),
  })
}

// Or hoisted form with metadata
const chargeWithRetry = defineStep(
  async (cardId: string, amount: number) => chargeCard(cardId, amount),
  { retries: 5, backoff: { kind: 'exponential', baseMs: 1000 } },
)
```

Both `chargeWithRetry` calls are just function calls. No ctx parameter:

```typescript
const result = await chargeWithRetry(profile.cardId, 999)
//    ^? { chargeId: string }
```

This is the most composable form possible. Helpers compose like any other async functions.

## Subworkflow

```typescript
const emailSeries = workflow(async (input: { userId: string }) => {
  await step(() => sendEmail(input.userId, 'welcome'))
  await sleep('1d')
  await step(() => sendEmail(input.userId, 'day-2'))
  await sleep('5d')
  await step(() => sendEmail(input.userId, 'day-7'))
})
```

## Full onboarding workflow

```typescript
import {
  workflow,
  step,
  sleep,
  waitForEvent,
  race,
  invoke,
  saga,
  defineEvent,
} from '@tanstack/workflow'

// Events declared as standalone typed primitives
const approved = defineEvent('approved', z.object({ approverId: z.string() }))
const rejected = defineEvent('rejected', z.object({ reason: z.string() }))

export const onboard = workflow(
  async (input: { userId: string }) => {
    const profile = await step(() => loadProfile(input.userId))
    //    ^? { id: string; cardId: string; email: string }

    await invoke(emailSeries, { userId: input.userId }, { detached: true })

    await sleep('1d')

    const decision = await race(
      {
        approved: waitForEvent(approved),
        rejected: waitForEvent(rejected),
      },
      { timeout: '7d' },
    )
    //    ^? { type: 'approved'; data: { approverId: string } }
    //     | { type: 'rejected'; data: { reason: string } }
    //     | { type: 'timeout' }

    if (decision.type === 'approved') {
      const result = await saga(async () => {
        const c = await chargeWithRetry(profile.cardId, 999)
        const a = await step(() => activateAccount(input.userId))
        return { c, a }
      })
      return {
        status: 'active' as const,
        userId: input.userId,
        by: decision.data.approverId,
        chargeId: result.c.chargeId,
      }
    }

    await step(() => markInactive(input.userId))
    return {
      status: 'inactive' as const,
      userId: input.userId,
      reason:
        decision.type === 'rejected'
          ? ('rejected' as const)
          : ('timed_out' as const),
    }
  },
  {
    name: 'onboard',
    input: z.object({ userId: z.string() }),
    events: [approved, rejected],
    retries: 2,
    timeout: '14d',
  },
)
```

The body reads like normal application code. No `ctx.step('foo', () => …)` ceremony. No string labels. The build transform makes step identity stable across renames.

## How the build transform works

For each `step(fn)`, `sleep(...)`, `waitForEvent(...)`, `invoke(...)`, `race({...})`, `saga(...)` call inside a `workflow(...)` body, the transform inserts a stable `__id__` argument derived from the AST position within the workflow:

```typescript
// User writes:
await step(() => loadProfile(input.userId))

// Transform produces:
await step(() => loadProfile(input.userId), { __id__: 'onboard:0' })
```

The IDs are:

- Stable across renames of the workflow function (positional, not name-based)
- Stable across whitespace/comment changes (AST-based, not line-based)
- Stable across JS minification (the `__id__` argument survives)
- Visible to devtools via source maps

Without the transform, a runtime fallback uses `Error.stack` to derive a position-based ID (~10× slower, less reliable across bundlers, fine for dev). Users can always pass explicit IDs as the escape hatch: `step(() => loadProfile(...), { id: 'load-profile' })`.

## Build tool integrations

- `@tanstack/workflow-vite` — Vite plugin
- `@tanstack/workflow-swc` — SWC plugin
- `@tanstack/workflow-esbuild` — esbuild plugin
- `@tanstack/workflow-babel` — Babel preset for Webpack/older toolchains
- `@tanstack/workflow-rollup` / `@tanstack/workflow-rolldown` — Rollup family

The transform logic lives in one place (`@tanstack/workflow-transform-core`), the per-bundler packages are thin shims.

## React binding

The hook API mirrors Candidate 1 — bindings don't change with definition style:

```typescript
function OnboardingStatus({ runId }: { runId: string }) {
  const run = useWorkflowRun(onboard, runId)
  if (run.state === 'completed' && run.result.status === 'active') {
    return <ActiveBadge by={run.result.by} />
  }
  return null
}
```

## Engine wiring (identical to Candidate 1)

```typescript
export const workflow = createEngine({
  storage: postgresStorage({ client: pool }),
  runtime: cronRuntime({ batchSize: 50 }),
  workflows: [onboard, emailSeries],
})
```

## How types flow through this design

Identical type-flow guarantees to Candidates 1 and 2, just with cleaner syntax at the call sites. The `workflow()` factory is overloaded to extract input/event/return types from the function signature + options:

```typescript
function workflow<TInput, TOutput, TEvents extends EventMap = {}>(
  fn: (input: TInput) => Promise<TOutput>,
  options?: WorkflowOptions<TInput, TEvents>,
): Workflow<TInput, TOutput, TEvents>
```

The `step` primitive:

```typescript
function step<TReturn>(
  fn: () => Promise<TReturn>,
  options?: StepOptions<TReturn>,
): Promise<TReturn>
```

`step` looks up the workflow context from AsyncLocalStorage and journals the result. No ctx parameter needed because the workflow's `run` is wrapped in a `AsyncLocalStorage.run()` scope.

## The composability win, illustrated

In Candidates 1 and 2, a helper that wants to use steps must take ctx:

```typescript
// Candidate 1/2
async function ensureProfile(ctx: WorkflowContext, userId: string) {
  let profile = await ctx.step('try-load', () => loadProfile(userId))
  if (!profile) {
    await ctx.step('create-profile', () => createProfile(userId))
    profile = await ctx.step('reload', () => loadProfile(userId))
  }
  return profile
}

// Caller:
const profile = await ensureProfile(ctx, userId)
```

In Candidate 3, the helper is just an async function — context flows ambiently:

```typescript
// Candidate 3
async function ensureProfile(userId: string) {
  let profile = await step(() => loadProfile(userId))
  if (!profile) {
    await step(() => createProfile(userId))
    profile = await step(() => loadProfile(userId))
  }
  return profile
}

// Caller:
const profile = await ensureProfile(userId)
```

The helper is callable from inside any workflow body, from any depth of nesting, from inside loops, from inside other helpers. No ctx threading ever.

This is **why** Candidate 3 wins on the "composable primitives" axis — the primitives compose at the _function_ level, not the _method-on-context_ level.

## The non-determinism guardrail

Because primitives use AsyncLocalStorage, calling `step()` _outside_ a workflow body must throw a clear error:

```typescript
// Anywhere outside a workflow body:
await step(() => doStuff())
//          ↳ Error: step() called outside a workflow context.
//            Did you mean to wrap this code in workflow(...) ?
```

The error is loud, actionable, and impossible to silently swallow.

## Pros and cons

**Pros:**

- **Highest composability.** Helpers are just async functions. They compose anywhere.
- **Lowest boilerplate.** Workflow bodies read like normal application code.
- **Stable step identity for free** (with transform). Renames don't break in-flight runs.
- **Cleanest debugger experience.** Stack traces show your code, not framework methods.
- **Strongest "TanStack DX" feel** — the same conceptual leap that made `useQuery()` win over `connect()(Component)` in 2019.
- **Same type safety guarantees** as Candidates 1 and 2.

**Cons:**

- **Build-tool dependency.** Must ship plugins for every major bundler. The maintenance burden is real — each major bundler version bump (Vite 7, esbuild API change, SWC migration) requires updates.
- **AsyncLocalStorage runtime cost.** Small but real per-step overhead.
- **"Magical" — context flow is invisible.** Stack traces show normal code, but the _why does this step have this ID_ answer is "the transform did it." Onboarding requires teaching the transform.
- **Edge runtime gotchas.** AsyncLocalStorage works on Node 16+, Bun, Deno, and Cloudflare Workers (with the `nodejs_compat` flag). Workers without that flag would need an explicit polyfill.
- **"Calling step() outside a workflow" must throw.** Easy to do accidentally in tests/scripts.

**Mitigations:**

- Provide a `runtimeOnly` fallback (no transform) that uses explicit IDs or stack-trace-derived IDs
- Provide a `runWithWorkflow(definition, input, fn)` test helper that sets up the AsyncLocalStorage scope
- Document the "must call inside workflow body" invariant prominently
- Ship a CLI that detects misuse: `npx tanstack-workflow check`

---

# Side-by-side comparison

## The same step extracted as a helper

```typescript
// Candidate 1 — explicit ctx threading
async function chargeWithRetry(
  ctx: WorkflowContext,
  cardId: string,
  amount: number,
) {
  return ctx.step('charge', () => chargeCard(cardId, amount), { retries: 5 })
}
// Caller: const r = await chargeWithRetry(ctx, cardId, 999)

// Candidate 2 — same as Candidate 1, plus middleware available
async function chargeWithRetry(
  ctx: WorkflowContext,
  cardId: string,
  amount: number,
) {
  return ctx.step('charge', () => chargeCard(cardId, amount), { retries: 5 })
}
// Caller: const r = await chargeWithRetry(ctx, cardId, 999)

// Candidate 3 — pure function composition
async function chargeWithRetry(cardId: string, amount: number) {
  return step(() => chargeCard(cardId, amount), { retries: 5 })
}
// Caller: const r = await chargeWithRetry(cardId, 999)
```

## Trade-offs at a glance

| Concern                      | Candidate 1                         | Candidate 2                        | Candidate 3                                   |
| ---------------------------- | ----------------------------------- | ---------------------------------- | --------------------------------------------- |
| Type safety                  | ✅ Strong, definition-object-driven | ✅ Strong, chain-narrowed          | ✅ Strong, inferred from primitive signatures |
| Step-level composability     | ⚠️ Requires explicit ctx threading  | ⚠️ Requires explicit ctx threading | ✅ Pure function composition                  |
| Cross-cutting composability  | ⚠️ Manual wrapping                  | ✅ Middleware chain                | ⚠️ Manual wrapping                            |
| Platform agnosticism         | ✅ Runtime only                     | ✅ Runtime only                    | ⚠️ Requires build transform integration       |
| Familiarity to TanStack devs | ✅ Highest (Query/DB/Router)        | ✅ High (Start createServerFn)     | ⚠️ Novel                                      |
| Step rename safety           | ⚠️ Footgun (string labels)          | ⚠️ Footgun (string labels)         | ✅ Safe (lexical position)                    |
| Boilerplate                  | Medium                              | Highest                            | Lowest                                        |
| Implementation risk          | Low                                 | Low                                | High (build toolchain)                        |
| Debugger / stack traces      | Clean                               | Clean                              | Cleanest                                      |
| Time-to-1.0                  | Fastest                             | Fast                               | Slowest (transform work)                      |
| AsyncLocalStorage required   | No                                  | No                                 | Yes                                           |
| TS compiler stress           | Low                                 | Medium-high (deep chains)          | Low                                           |

## Hello world line count

- Candidate 1: 6 lines
- Candidate 2: 7 lines
- Candidate 3: 4 lines

## Full onboarding workflow line count (signal only — measured from the examples above, excluding shared imports)

- Candidate 1: ~45 lines
- Candidate 2: ~50 lines
- Candidate 3: ~40 lines

The line count is close. The difference is felt in _helper_ code, where Candidate 3 saves dozens of lines per helper because ctx threading is gone.

---

# Recommendation

## Phased adoption — the hybrid

The strongest play is to ship Candidate 1 as the foundation and graduate to Candidate 3 sugar via an opt-in build transform. This preserves platform agnosticism (the library works without the transform) while delivering best-in-class DX for users who opt in.

**Phase 1 (1.0):** Ship Candidate 1 — `createWorkflow({ name, input, run })` with explicit `ctx`. Battle-test the engine, storage adapters, runtime adapters, devtools. No transform. Lowest risk.

**Phase 2 (1.x):** Add an optional `@tanstack/workflow-vite` (and SWC / esbuild / Babel) plugin that lets users omit the string-label argument on `ctx.step(fn)`. Lexical-position ID derivation. Still Candidate 1 shape; renames become safe; users don't have to change anything.

**Phase 3 (2.0 or experimental):** Introduce Candidate 3 — `workflow(async (input) => …)` with implicit context. Users who want maximum DX opt in. Backwards compatibility maintained by keeping Candidate 1's API in the package.

**Skip Candidate 2** unless middleware composition becomes a strong community ask. The TanStack Start `createServerFn` shape is great for HTTP handlers but workflow-level middleware tends to fragment into many tiny wrappers in practice (auth + tracing + logging + retry + idempotency); composing them via middleware chains becomes hard to read. The same benefits can be delivered via Candidate 1's `defineStep` carrying its own behavior — and via explicit utility functions.

## If you have to pick one

**Pick Candidate 1.** It's the safest path to 1.0, the closest match to existing TanStack conventions, and the most likely to land cleanly across every deployment target without toolchain risk. Ship it. Iterate the engine quality, the devtools, the adapters, the docs. Win the durability quality + DX battle on those merits.

Then layer in the lexical-position transform as Phase 2 — it's a strict improvement over explicit string labels, with zero breaking changes to the runtime API.

Consider Candidate 3 a long-term ambition. It's the right destination, but only after the engine itself is rock-solid and the transform is battle-tested across bundlers. The "implicit context" leap is the same magnitude of conceptual jump that React Hooks were in 2018-2019 — worth doing, worth doing carefully, not worth rushing.

## What to validate before committing

1. **Prototype Candidate 1's `defineStep` ergonomics.** Write 10 real workflow examples; see if explicit ctx threading bothers contributors in practice.
2. **Prototype Candidate 3's build transform against Vite + esbuild + SWC.** A weekend spike is enough to know if the toolchain integration is feasible at TanStack's quality bar.
3. **Test middleware composition in a Candidate 2 prototype.** Decide if it's a feature or a distraction. The bar: does a real org-wide-conventions composition actually compose cleanly across 5+ workflows without TS performance regressions?
4. **Test inference depth.** Race + saga + sub-workflow nested 3-deep — does TS infer the full discriminated union? Where does inference fail and require annotations?
5. **Validate the engine's primitives are stable.** All three candidates share the same engine. Build the engine first; the API skin can change.

## Final word

The three designs above are all _viable_. None of them are wrong. The differences are about _how much DX risk you're willing to take vs. how fast you want to ship_. TanStack's history is shipping safe defaults and iterating toward magic — Query started without Suspense, Router started without code generation, Start started without RSC. The same playbook applies: **ship Candidate 1, layer in the transform, eventually reach Candidate 3 syntax.**

The hedge isn't picking the perfect API on day one. The hedge is shipping the engine + adapters + devtools + Start integration before anyone else does it with TanStack-grade type inference and headless framework adapters. The API skin can evolve.

Ship Candidate 1. Ship it well. The market wants this.
