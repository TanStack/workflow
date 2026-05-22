# TanStack Workflow — Research Dump

> Compiled May 19, 2026. Eight parallel research streams; mix of web sources, local TanStack repo reads, and synthesis. Confidence is highest on prior-art landscape and TanStack's own signals, weaker on Q1–Q2 2026 specifics where memory had to fill in for some research streams.

---

## 0. The headline finding: you have already publicly drafted this library

Two artifacts in the TanStack blog plus today's empty `/Users/tannerlinsley/GitHub/workflow/` directory converge on a single conclusion: this is the "massive new library" you've already teased, and you've publicly sketched the API.

### a. "Directives and the Platform Boundary" — 2025-10-24

In your own post arguing against `'use workflow'` / `'use step'` directives, you wrote the contrast example as a near-complete API:

```js
import { workflow, step } from '@workflows/workflow'

export const sendEmail = workflow(
  async (input) => {
    /* ... */
  },
  { retries: 3, timeout: '1m' },
)

export const handle = step(
  'fetchUser',
  async () => {
    /* ... */
  },
  { cache: 60 },
)
```

You also list, verbatim, what you think the "real problems worth solving" are:

- Server execution boundaries
- Streaming and async workflows
- Distributed runtime primitives
- Durable tasks
- Caching semantics

This is the manifesto. You picked workflow as the worked example because you'd been thinking about it.

### b. "The State of TanStack, Two Years of Full-Time OSS" — 2025-11-24

> "And yes, we've already started work on a massive new library that will take most of next year to get off the ground. It's one of the biggest things we've ever attempted. I can't share details yet, but it will open a new chapter for the entire ecosystem."

### c. TanStack DB 0.6 — 2026-03-25

The DB team (Sam Willis, Kevin De Porre) shipped `createEffect` and explicitly framed DB+DO+SQLite as "a durable state engine for agent workflows, not just a UI data layer." This is the persistence substrate landing in advance of the workflow layer.

### d. The empty `/Users/tannerlinsley/GitHub/workflow/` directory created today

Self-explanatory. The work has started.

### Directional read

1. **Import-shaped, not directive-shaped.** You've publicly argued for this.
2. **`workflow(fn, options)` + `step(name, fn, options)`** is the API skeleton.
3. **Options-rich**: `retries`, `timeout`, `cache` shown; expect `idempotencyKey`, `concurrency`, `version`, `signal`.
4. **Type-safe, framework-agnostic, headless** — TanStack defaults apply.
5. **TanStack DB is being positioned as the substrate.** `createEffect` with `onEnter` / `AbortSignal` is exactly the shape a workflow runtime needs.
6. **2026 ramp.** "Most of next year" from Nov 2025 means Q4 2026 alpha-ish, with public surface emerging through 2026.

---

## 1. The competitive landscape (May 2026)

Five camps. Know where you fit before deciding what to build.

| Camp                            | Examples                                                          | DX feel                       | What they win on                                | What they lose on                                           |
| ------------------------------- | ----------------------------------------------------------------- | ----------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| **Enterprise durable engines**  | Temporal, Cadence, Restate                                        | "Constrained async + sandbox" | Industrial-grade durability, deep introspection | Heavy ops, Java-shaped APIs, painful in TS                  |
| **TS-first serverless SaaS**    | Inngest, Trigger.dev v4                                           | "Just write a function"       | Best DX, fast onboarding, marketplaces          | Vendor lock-in, pricing surprises, control-plane stickiness |
| **DB-backed durable execution** | DBOS, Hatchet, Resonate                                           | "Postgres is the engine"      | Lightest ops, transactional with business state | Smaller communities, TS often second-class                  |
| **Platform-tied**               | Cloudflare Workflows, AWS Step Functions, Azure Durable Functions | Varies                        | Cheap, zero-ops, deep platform integration      | Total vendor lock-in                                        |
| **AI-agent frameworks**         | LangGraph.js, Mastra, Vercel AI SDK, Inngest AgentKit             | "Graph of LLM calls"          | LLM-shaped primitives, streaming, tool loops    | Narrow scope, durability is bolted on (except LangGraph)    |

### Detailed profiles

**Temporal** — Event-sourced replay. Workflow code runs in an isolated v8 sandbox; every `Date.now()` / `Math.random()` / `setTimeout` is intercepted and made deterministic; history is the source of truth. TS SDK is solid but Java-shaped. Determinism rules and mid-flight versioning are the dominant pain points. Cluster needs Cassandra/MySQL/Postgres + optional Elasticsearch. Mid-tier of price/complexity unless on Temporal Cloud. **TS DX: 6/10.**

**Inngest** — "Inngest calls you, not the other way around." Event-driven functions that expose a single HTTP endpoint (`/api/inngest`); their cloud invokes it per step, memoizing step results by label. Best DX in category. Excellent local dev server. Pain: HTTP overhead per step (10-step workflow = 10 invocations), step renames break in-flight runs, self-host trails cloud. **TS DX: 9/10.**

**Trigger.dev v4** — Recently GA in 2025. Heap-state checkpointing means you write plain async code without thinking about step boundaries (they snapshot the V8 heap and restore on a different machine). v4 made self-hosting actually approachable — Docker Compose with built-in registry/object storage, official Kubernetes Helm chart with integrated Postgres + Redis + storage. They build & run your code on their infra. Strong AI workflow story. **TS DX: 8.5/10.** ([self-hosting docs](https://trigger.dev/blog/self-hosting-trigger-dev-v4-docker), [v4 GA](https://trigger.dev/launchweek/2/trigger-v4-ga))

**Restate** — Single Rust binary, embedded RocksDB, no external DB required. Combines workflows, virtual actors (called Virtual Objects), and durable RPC. Stateless SDK handler called over HTTP/2 by the runtime. Operationally the lightest of the heavyweights. Ex-Apache Flink team. Newer; smaller community. **TS DX: 7.5/10.**

**Hatchet** — Postgres-only. Single binary + Postgres = your entire workflow engine. Heavy use of `SELECT … FOR UPDATE SKIP LOCKED`. YC W24. Honest about Postgres ceilings at very high throughput. TS SDK lags Python/Go. **TS DX: 6.5/10.**

**Resonate** — Durable Promises as the universal primitive. Apache 2.0 Go binary, SQLite or Postgres backing. Ex-Temporal team. Niche but credible. **TS DX: 7/10.**

**DBOS** — Stonebraker / MIT pedigree. Postgres is the engine — workflow state lives in your application's own database. Decorators (`@DBOS.workflow()`, `@DBOS.transaction()`). True exactly-once for the transactional path. Decorator-heavy feels dated in modern TS. **TS DX: 6.5/10.**

**Cloudflare Workflows** — `class extends WorkflowEntrypoint` with `step.do()`. Backed by Durable Objects. Bound to Cloudflare runtime (V8 isolates, npm caveats). Zero ops if you're already on CF. **TS DX: 7/10.**

**AWS Step Functions** — ASL JSON or CDK. Standard vs Express flavors. Bulletproof, integrates with every AWS service, JSON DSL hell at scale, AWS lock-in. **TS DX: 5/10.**

**Azure Durable Functions** — Generator-based orchestrators (`yield context.df.callActivity(...)`). Replay-based like Temporal. `yield` losing type info is a real TS pain. Azure-only. **TS DX: 5.5/10.**

**Defer** — RIP. YC-backed TS background jobs platform; shut down 2024. Lesson: TS-only background jobs is crowded; me-too kills you.

### AI-flavored workflow tier (this is the hot growth segment)

**Mastra** — 22k+ stars in 15 months, 300k+ weekly npm downloads by Jan 2026 GA. Open-source TS AI agent framework. Six primitives: agents, workflows, tools, memory, RAG, evals. Workflows are deterministic step graphs with suspend/resume + time-travel debugging. From the Gatsby team. Includes "Studio" UI. ([Mastra docs](https://mastra.ai/docs), [GitHub](https://github.com/mastra-ai/mastra))

**Vercel AI SDK 6** — Unified `generateObject`+`generateText`. `ToolLoopAgent` class for the standard tool-use loop. `stopWhen: stepCountIs(N)` configures multi-step. Streaming-first, not durable. ([AI SDK 6 blog](https://vercel.com/blog/ai-sdk-6))

**LangGraph.js** — Built-in persistence layer with `Checkpointer` saves state after every node execution. PostgreSQL/Redis backed. Resumable across deploys and process restarts. Diagrid wrote a pointed critique titled "Checkpoints Are Not Durable Execution" arguing LangGraph's model falls short of real durable execution for production agent workflows. ([LangGraph durable execution](https://docs.langchain.com/oss/javascript/langgraph/durable-execution), [Diagrid critique](https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows))

**XState v5** — Actor model is the focal abstraction. Actors are deeply (recursively) persisted in v5, unlike v4. Restate published a guide on combining XState + Restate to get durable state machines on serverless. Statecharts are the right tool when the model genuinely is "states with transitions"; ceremonial when the model is "sequence of steps." ([Restate + XState](https://www.restate.dev/blog/persistent-serverless-state-machines-with-xstate-and-restate), [XState v5 release](https://stately.ai/blog/2023-12-01-xstate-v5))

**Inngest AgentKit / Trigger.dev AI tasks** — Both have shipped AI-shaped APIs on top of their existing engines. They're bolted on rather than ground-up AI, but they ride durable execution which is a real advantage.

---

## 2. Technical architecture patterns

Eight patterns underlie everything above. Pick your pattern; everything else follows.

### Pattern 1: Event-sourced replay (Temporal, Cadence)

Workflow code is re-executed from history every time it needs to make progress. Every primitive call (`activity`, `sleep`, `condition`, `setHandler`) is intercepted and checked against the event log. If the result is in history → return cached; else → record a command and block.

**Pros:** Best-in-class introspection, full event log, code reads like normal async/await
**Cons:** Strict determinism, mid-flight versioning via `patched()`, sandbox quirks (most npm packages break in workflow code)
**Storage cost:** ~300 events for a workflow with 100 activities + 50 timers

### Pattern 2: Continuation / checkpoint persistence (Restate)

Persist execution context after each step. Resume by loading. Replay still happens within a single invocation, but only `ctx.*` boundaries are journaled — code outside is just user code.

**Pros:** Smaller journal, more forgiving determinism contract, stateless service runs anywhere
**Cons:** Suspension only at `ctx.*` boundaries, less granular debuggability

### Pattern 3: Step-as-DAG / IR (AWS SFN, Inngest)

Workflow body is a description that compiles to an execution graph. The runtime traverses the graph; user code is invoked piecemeal.

For Inngest specifically: each `step.run` call boundary causes the runtime to **re-invoke your function over HTTP** with the previously-cached results substituted. This is replay-via-HTTP, which is why "anything not wrapped in `step.run` runs on every step" is the Inngest gotcha.

**Pros:** User code is stateless, edge/serverless friendly, easy versioning (deploy new code), DX feels like writing a function
**Cons:** HTTP overhead per step, step names are identifiers (rename = break in-flight)

### Pattern 4: Coroutine / async-state-machine (DBOS, Azure Durable Functions, Effect)

Lean on language-native suspension points (`async/await`, `yield`, generators) so the compiler already knows where to checkpoint. DBOS does this with decorators + Postgres journaling. Effect does it with its fiber scheduler.

**Pros:** Feels like native code, lower runtime overhead than full replay
**Cons:** Tied to a specific runtime model, versioning still hard

### Pattern 5: Reactive / observable (XState statecharts)

A workflow is a finite hierarchy of states with event-driven transitions. The interpreter drives transitions.

**Pros:** Visual reasoning, parallel regions, hierarchical states
**Cons:** Long durations require external timer events, type ergonomics for deeply nested hierarchies get heavy, not built for "30-day sleep, then call API"

### Pattern 6: Virtual actors (Cloudflare DO, Orleans, Dapr)

Per-ID addressable, single-threaded, durable, with self-scheduling alarms. A _substrate_, not a workflow library on its own — Cloudflare Workflows is the workflow API on top of DO.

**Pros:** Concurrency control free, durable timers built in, signals = messages
**Cons:** Platform lock-in, cross-actor coordination is on you

### Pattern 7: DB-backed queues (Hatchet, pg-boss, BullMQ)

Just a job queue (Postgres/Redis) with a thin workflow layer. Each step is a DB transaction. Wake-up via `LISTEN/NOTIFY` (Postgres), Redis streams, or polling.

**Pros:** BYO database, transactional consistency with business state, debuggable via SQL
**Cons:** Lower-level user code, Postgres has scaling ceilings, no built-in signals

### Pattern 8: Saga pattern (cross-cutting)

Sequence of local transactions, each with a compensating action. Run compensations in reverse on failure. Orthogonal to execution pattern — every other pattern can implement sagas.

**Pros:** Distributed transactions without 2PC
**Cons:** Compensations must be idempotent, easy to write incorrect ones

### The cross-cutting dimensions that actually matter

| Dimension                   | Strong determinism (Temporal) | Soft determinism (Inngest/Restate) | None (XState/queues)      |
| --------------------------- | ----------------------------- | ---------------------------------- | ------------------------- |
| **Determinism enforcement** | Sandbox + intercepted globals | Step-boundary memoization          | N/A                       |
| **User code feels like**    | Constrained async             | Normal async with `ctx.run`        | Imperative or declarative |
| **Mid-flight versioning**   | Painful (`patched()`)         | Manageable (named steps)           | Schema migration          |
| **Edge/serverless fit**     | Bad (workers hold state)      | Excellent (stateless calls)        | Excellent (just code)     |
| **BYO database**            | No                            | Sometimes                          | Yes                       |

---

## 3. Deployment-agnostic architecture

This is the biggest unique angle for TanStack and the one where existing players are weakest.

### The runtime archetype trinity

Every deployment target reduces to one of three archetypes:

1. **Always-on process** — Fly machines, Railway, Render, Node, Bun, Docker, Fargate. Can hold sockets, run pollers, keep `LISTEN/NOTIFY` open. Easy mode.
2. **Scale-to-zero serverless** — Vercel Functions, Lambda, Netlify, CF Workers (no DO), Deno Deploy. Each invocation is fresh. State must live externally. Long sleeps = "park the workflow, cron will wake it."
3. **Durable actor** — CF Durable Objects, Deno KV queues, Temporal/Restate workers. A named, persistent instance with its own storage and self-scheduling alarms.

A deployment-agnostic library means: the same workflow definition compiles to all three, and the user picks per deployment.

### The deployment matrix (key cells)

| Target                     | Long-lived process?    | Native durable storage          | Native scheduler              |
| -------------------------- | ---------------------- | ------------------------------- | ----------------------------- |
| Vercel Functions           | No                     | Vercel Postgres, KV, Blob       | Vercel Cron (1 min)           |
| Cloudflare Workers         | No (per-request)       | KV, R2, D1, Hyperdrive→Postgres | Cron Triggers (1 min), Queues |
| Cloudflare Durable Objects | **Yes** (actor)        | Per-object SQLite               | `state.storage.setAlarm()`    |
| AWS Lambda                 | No                     | DynamoDB, RDS, S3               | EventBridge                   |
| Fly Machines               | Yes (scale-to-zero ok) | Volumes, LiteFS, Postgres       | App-level cron                |
| Bun / Node / Docker        | Yes                    | Any                             | Any                           |
| Deno Deploy                | No                     | Deno KV (FoundationDB)          | Cron + Queues                 |

### Three storage shapes worth shipping as first-class

1. **Relational** — Postgres / SQLite / D1 / libsql. `SKIP LOCKED` or polling.
2. **Key-value with sorted sets** — Redis / Upstash / Deno KV. Hash for state, ZSET for timers.
3. **Single-actor SQLite** — Cloudflare DO, embedded driver, no network.

DynamoDB and friends become community adapters.

### TanStack's adapter pattern, applied

The lesson from `db-sqlite-persistence-core/src/persisted.ts` and the TanStack DB `SQLiteDriver` interface: **the engine owns the schema; the driver is just a transport.** Five methods (`exec`, `query`, `run`, `transaction`, `transactionWithDriver`) and the same engine runs on Node `better-sqlite3` or Durable Object SQL.

For workflow, the minimum driver surface looks like:

```typescript
interface WorkflowStorage {
  // Run lifecycle
  createRun(run: NewRun): Promise<Run>
  getRun(id: string): Promise<Run | null>
  updateRun(id: string, patch: Partial<Run>): Promise<void>

  // Step memoization (THE durable execution log)
  getStepResult(runId: string, stepId: string): Promise<StepResult | null>
  putStepResult(
    runId: string,
    stepId: string,
    result: StepResult,
  ): Promise<void>

  // Timers
  scheduleTimer(timer: ScheduledTimer): Promise<void>
  claimDueTimers(limit: number, now: Date): Promise<ScheduledTimer[]>

  // Event waits
  registerEventWait(wait: EventWait): Promise<void>
  matchEvents(name: string, payload: unknown): Promise<EventWait[]>

  // Atomic claim — only one worker gets a given run
  claimNextRun(workerId: string, lockMs: number): Promise<Run | null>
  releaseRun(runId: string): Promise<void>

  // Transaction wrapper
  transaction<T>(fn: (tx: WorkflowStorage) => Promise<T>): Promise<T>
}

interface WorkflowRuntime {
  start(engine: WorkflowEngine): Promise<void>
  stop(): Promise<void>
  onWake?(callback: () => void): void // for LISTEN/NOTIFY-style push
}
```

### Three runtime adapters

- **`@tanstack/workflow-cron`** — handler you wire into Vercel Cron / CF Cron / EventBridge / `Deno.cron`. Batches work per tick. 1-minute granularity acceptable.
- **`@tanstack/workflow-worker`** — always-on poller loop with optional `LISTEN/NOTIFY` push. For Fly / Railway / Render / Node.
- **`@tanstack/workflow-durable-object`** — one DO per run, alarm-driven. Coupled with `@tanstack/workflow-do-storage`.

### What breaks deployment agnosticism (be honest about these)

- **Long sleeps** with cron runtime have ≥1-minute precision skew
- **Large fan-out** stresses Postgres (10k inserts), DynamoDB (write capacity), CF Workers Queues (per-msg price)
- **Parent-child workflows across runtimes** must always go through storage, never in-process calls — adds latency but preserves portability
- **Postgres on Cloudflare Workers** requires Neon serverless driver or Hyperdrive, not raw `pg`
- **Workflow non-determinism** (`Math.random()` outside `step.run`) must be detected and thrown loudly, not silently allowed to diverge
- **Cloudflare KV is not viable as state store** — eventual consistency breaks workflow semantics
- **CPU-heavy steps on Workers** hit the 30-sec CPU limit; document for users

### The single most important architectural choice

**Everything goes through storage.** Never in-process function calls between workflows or steps. Storage is the only thing the library can guarantee is shared across cold serverless invocations, across DOs, across worker processes.

---

## 4. The market gap — where TanStack actually has a hedge

### What the existing crowd does badly

| Painpoint (recurring across HN/Reddit/blog sentiment)                    | Existing libs                                                                                                         |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Step IDs are string-keyed black boxes; refactoring breaks in-flight runs | Inngest, Trigger.dev, CF Workflows                                                                                    |
| Workflow payloads degrade to `any` once they cross serialization         | Temporal, Step Functions, all SaaS engines                                                                            |
| Surprise bills when step count spikes                                    | Inngest, Temporal Cloud, Trigger.dev cloud                                                                            |
| Can't `SELECT *` to see what's stuck                                     | All SaaS engines                                                                                                      |
| Self-host is "supported but you're on your own"                          | Inngest, Trigger.dev (less true after v4), Restate                                                                    |
| Streaming LLM tokens + durable workflows is awkward                      | Almost everyone — Vercel AI SDK does streaming but not durable, Inngest/Trigger do durable but streaming is bolted on |
| Local dev story is "run a cluster" or "use our cloud"                    | Temporal, Trigger.dev, Restate                                                                                        |
| Observability is bolted on (OTEL is uneven)                              | Most engines                                                                                                          |
| Migrating in-flight workflows during a deploy is terrifying              | Temporal (sharp), DBOS (better), others variable                                                                      |
| Vendor abstractions leak into your business code                         | Inngest `step.*`, Temporal `proxyActivities`, SFN ASL                                                                 |

### What TanStack uniquely can do

1. **End-to-end inference through every step.** The TanStack Router / Query pattern of types flowing through call sites is the single biggest underserved demographic in workflows. Step IO inferred from closure types; event payloads typed from a Standard Schema; invoke call sites carry full return types.

2. **Embedded engine, not a control plane.** `npm install`, write a function, await it. Postgres / SQLite / DO are _adapters_, not requirements. Closest analog is DBOS — but DBOS is decorator-heavy and Python-first.

3. **Core + framework adapters.** `@tanstack/react-workflow`, `@tanstack/solid-workflow` with `useWorkflowRun(id)` and `useWorkflowStream(id)` hooks. **Nobody** has shipped framework binding hooks for workflows. Bury Inngest's dashboard inside the user's own app.

4. **In-app, framework-agnostic devtools.** A drop-in inspector showing every run, every step, every retry, every payload — using your data, your servers. Inngest's UI is great but it's their dashboard, not yours.

5. **TanStack DB as the persistence + reactive substrate.** `createEffect` already exposes `onEnter` / `onExit` / `onUpdate` with `AbortSignal`. Workflow runs become rows in a DB collection; the workflow engine reacts to query results.

6. **TanStack Start native integration.** Server functions return workflow handles. Route loaders subscribe to runs. Streaming RSC + durable workflow + suspense — that combination doesn't exist anywhere else cleanly.

### Three positioning angles, ranked

**#1 — "Durable execution that flows with your types, not against them."** Headline pitch. The gap nobody is filling. Modeled after Router/Query inference. Most defensible. Most TanStack-true.

**#2 — "The workflow engine that's just a library."** Practical pitch. Postgres-backed by default, SQLite for dev, no SaaS account. Devtools drop into your app. Direct attack on the "I just want background jobs that survive a deploy" segment.

**#3 — "Streaming + durable. The AI-app workflow engine."** Flagship use case in launch materials, not the headline. The AI space is too volatile to bet positioning on. But streaming-first durable execution is a real gap — Vercel AI SDK does streaming, not durability; Inngest does durability, streaming is bolted on; LangGraph.js does checkpoints, but Diagrid's critique that "checkpoints are not durable execution" lands.

### The threats — be honest

1. **Inngest and Trigger.dev have 2–4 years and engineering teams 10× larger.** Out-DXing them on day one is hard.
2. **Building a durable engine is genuinely difficult.** Temporal has 100+ engineers and still finds bugs at scale. First versions will have rough edges.
3. **AI workflow space moves faster than TanStack's typical cadence.** LangGraph, Mastra, AI SDK ship monthly.
4. **Workflow code is sticky.** TAM is mostly greenfield. Slower TAM than Query/Table addressed at launch.
5. **"Headless" pattern is harder to apply to workflows than to UI.** Differentiation must come from types, devtools, deployability.
6. **DBOS, Hatchet already occupy the "your DB is the engine" niche.** TanStack must be meaningfully better on TS DX, not just present.
7. **Funding model unclear.** Workflow libraries have a smaller installed base ceiling than Query.

---

## 5. Recommended MVP scope (six-month path to 1.0)

### Packages

- **`@tanstack/workflow-core`** — Engine, executor, step contract, run lifecycle, retry, sleep/timer, signals, run observable. Pure TS, zero deps. In-memory adapter bundled for dev.
- **`@tanstack/workflow-postgres`** — Production-grade Postgres adapter. Transparent, documented schema. `SKIP LOCKED` claims. `LISTEN/NOTIFY` for low-latency wake-up. Works with `pg`, `postgres.js`, `drizzle`, Neon serverless, Hyperdrive.
- **`@tanstack/workflow-sqlite`** — `better-sqlite3` / `node:sqlite` / `libsql` / Turso. Default for self-hosted single-process.
- **`@tanstack/workflow-d1`** — Cloudflare D1 variant.
- **`@tanstack/workflow-durable-object`** — Storage + runtime coupled. One DO per run.
- **`@tanstack/workflow-redis`** — ioredis / Upstash REST.
- **`@tanstack/workflow-cron`** — Wake-up handler for Vercel Cron / CF Cron / EventBridge / Deno Cron.
- **`@tanstack/workflow-worker`** — Always-on poller.
- **`@tanstack/react-workflow`** — `useWorkflow`, `useWorkflowRun`, `useWorkflowStream`.
- **`@tanstack/solid-workflow`** — Same hooks. Ship at launch to credibly call "framework-agnostic."
- **`@tanstack/workflow-devtools`** — Framework-agnostic core with React/Solid bindings.
- **`@tanstack/workflow-start`** — TanStack Start integration. Server functions return workflow handles.

### API skeleton (informed by your blog post)

```typescript
import { workflow, step } from '@tanstack/workflow'

export const onboard = workflow(
  {
    name: 'onboard',
    input: z.object({ userId: z.string() }),
    events: {
      approved: z.object({ approverId: z.string() }),
      rejected: z.object({ reason: z.string() }),
    },
    run: async (ctx, { userId }) => {
      const profile = await ctx.step('load-profile', () => loadProfile(userId))
      //    ^? Profile (inferred from loadProfile's return type)

      await ctx.sleep('1d')

      const decision = await ctx.waitForEvent('approved', { timeout: '7d' })
      //    ^? { approverId: string } | null

      if (!decision) return { status: 'timed_out' as const, userId }

      await ctx.step('activate', () => activate(userId))
      return { status: 'active' as const, userId, by: decision.approverId }
    },
  },
  {
    retries: 3,
    timeout: '1h',
    version: 'auto', // pinned to build SHA by default
  },
)

// Calling site:
const handle = await client.start(onboard, { userId: '123' })
//    ^? WorkflowHandle<{ status: 'timed_out'; userId: string }
//                    | { status: 'active'; userId: string; by: string }>
```

### Six design commitments (the manifesto)

1. **Native `async/await`, no sandbox.** Step-boundary memoization, not full replay. The Inngest / Restate model.
2. **Steps are typed callbacks, not labels.** Inferred names from lexical position via a build-time transform; explicit string names as fallback. Renaming a step doesn't break in-flight runs.
3. **Versioning is automatic and on by default.** Every run pins to the code SHA that started it. New deploys can't break in-flight runs.
4. **Single source of truth: storage.** No in-process workflow-to-workflow calls. Everything goes through the storage adapter.
5. **Schema-typed events.** Standard Schema everywhere. Zod / Valibot / ArkType all work.
6. **No decorators.** Function-first. `as const` and `satisfies` for type narrowing.

### Explicitly out of scope for 1.0

- Hosted cloud plane
- Multi-tenant isolation, RBAC, audit logging — Pro tier later
- Distributed engine beyond a single Postgres / single-region storage — phase 2
- Vue / Svelte / Angular bindings — phase 2 or community
- Visual workflow builder — never
- Built-in integrations directory (a la Inngest's 100+) — let users compose with normal code

### Launch story

> **Type-safe durable workflows for TanStack apps. Postgres-backed. Self-hosted by default. Streaming-aware. Devtools included.**

---

## 6. The business model

Ranked by fit with TanStack's history:

1. **OSS core + Pro devtools / Pro adapters (recommended).** Free engine, free core devtools, paid Pro for: multi-tenant isolation, audit logging, advanced replay debugger, SSO for devtools UI, premium adapters (Temporal-compat shim, etc.). Closest to TanStack Table/Form/Router Pro pattern.

2. **OSS + Start Cloud bundling.** Workflow is a free library; the durable hosting is part of Start Cloud. Pulls Start adoption.

3. **OSS + hosted "TanStack Workflows" cloud.** Same shape as Inngest/Trigger.dev. Higher revenue ceiling but **operationally brutal** — Inngest/Trigger are 20–50 engineer teams largely because of ops cost. Wrong scope for first 18 months.

4. **Pure OSS like Query/Table.** Sponsorship + halo. Lowest revenue, highest community velocity. Always viable.

**Strongest fit: #1 with optional #2.** OSS core must be genuinely complete — no crippleware. Query and Table set that expectation.

---

## 7. Open questions to resolve before committing

1. **Build-time transform vs runtime-only?** Stable step identity via lexical position requires a build transform. Worth the toolchain commitment? (Probably yes — it's the durable execution version of "automatic key inference.")
2. **TanStack DB as required substrate or optional substrate?** Tightly coupled DB ↔ Workflow is unique to TanStack and a huge moat, but it adds friction for users who want to drop the workflow lib into a non-DB app.
3. **Standard Schema first vs Zod first?** Standard Schema is the right call but tooling is still maturing.
4. **Embedded engine vs separate worker process?** The same engine code can do both via the runtime adapter. But which is the _default_ a new user gets out of the box?
5. **Cloudflare DO storage vs Postgres adapter as the "showcase" production setup?** DO has the best DX but locks to Cloudflare; Postgres is universal but adds infra.
6. **AI SDK integration story.** Tight integration (workflow knows about LLM streams) vs loose (workflow doesn't know, just calls AI functions inside steps).
7. **Naming.** "Workflow" is fine but generic. "TanStack Tasks"? "TanStack Durable"? "TanStack Run"? The repo is `workflow` — keep it.

---

## 8. References

### Primary TanStack sources

- [Directives and the Platform Boundary](https://tanstack.com/blog/directives-and-the-platform-boundary) — Tanner, 2025-10-24 (the API sketch lives here)
- [The State of TanStack, Two Years of Full-Time OSS](https://tanstack.com/blog/tanstack-2-years) — Tanner, 2025-11-24 (the teaser)
- [TanStack DB 0.6](https://tanstack.com/blog/tanstack-db-0.6-app-ready-with-persistence-and-includes) — 2026-03-25 (the substrate)
- [TanStack AI Code Mode](https://tanstack.com/blog/tanstack-ai-code-mode) — 2026-04-08 (orchestration framing)

### Workflow platforms

- [Trigger.dev v4 GA](https://trigger.dev/launchweek/2/trigger-v4-ga)
- [Trigger.dev self-hosting docs](https://trigger.dev/docs/self-hosting/overview)
- [Trigger.dev v4 Docker self-hosting](https://trigger.dev/blog/self-hosting-trigger-dev-v4-docker)
- [Trigger.dev v4 Kubernetes self-hosting](https://trigger.dev/blog/self-hosting-trigger-dev-v4-kubernetes)
- [Inngest GitHub](https://github.com/inngest/inngest)
- [Inngest pricing](https://www.inngest.com/pricing)
- [Mastra GitHub](https://github.com/mastra-ai/mastra)
- [Mastra docs](https://mastra.ai/docs)
- [LangGraph durable execution](https://docs.langchain.com/oss/javascript/langgraph/durable-execution)
- [LangGraph GitHub](https://github.com/langchain-ai/langgraph)
- [Diagrid: "Checkpoints Are Not Durable Execution"](https://www.diagrid.io/blog/checkpoints-are-not-durable-execution-why-langgraph-crewai-google-adk-and-others-fall-short-for-production-agent-workflows) (sharp critique of LangGraph/CrewAI/Google ADK)
- [Vercel AI SDK 6](https://vercel.com/blog/ai-sdk-6)
- [Vercel AI SDK docs](https://ai-sdk.dev/docs/introduction)
- [XState v5 release](https://stately.ai/blog/2023-12-01-xstate-v5)
- [XState GitHub](https://github.com/statelyai/xstate)
- [Restate + XState integration](https://www.restate.dev/blog/persistent-serverless-state-machines-with-xstate-and-restate)
- [LangGraph vs Temporal for AI Agents](https://medium.com/data-science-collective/langgraph-vs-temporal-for-ai-agents-durable-execution-architecture-beyond-for-loops-a1f640d35f02) (March 2026)
- [Agent framework comparison: LangChain vs LangGraph vs CrewAI vs PydanticAI vs Mastra vs Vercel AI SDK](https://www.speakeasy.com/blog/ai-agent-framework-comparison) (Speakeasy)

---

## 9. Distribution — the underrated half of the hedge

Library quality wins narrowly. Library distribution wins broadly. TanStack Query didn't beat SWR purely on merit — it won because it got embedded in every template, scaffold, tutorial, and LLM training corpus. Workflow has even better distribution dynamics if played right.

### a. AI app builders are a massive force multiplier

**Lovable** is the obvious one. Their generated apps already use TanStack Query. AI workflows (agent loops, background generation, scheduled tasks, webhook fan-outs) are increasingly core to what they ship. If TanStack Workflow lands in their default scaffold, you get instant adoption at _app-generation scale_ — millions of apps, not millions of installs. Each generated app becomes a real codebase that keeps the dependency forever.

Same dynamic applies to:

- **v0 (Vercel)** — generates Next.js apps; will push their own story but composes with adoptions like AI SDK that compose with workflow
- **Bolt.new (StackBlitz)** — multi-framework, will pick whatever's idiomatic
- **Replit Agent** — full-stack including workflows; underrated reach
- **Same.new, Genie, Devin, Codex, Manus** — long tail
- **Cursor / Claude Code / Windsurf** — IDE-level code suggestion; even more powerful than scaffolds because every codebase is touched

The mental model: **every AI app generator is a distribution channel that compounds over time.** Get into the prompt of the major ones early.

### b. The LLM training-data flywheel

TanStack Query won partly because every LLM trained on JS code now defaults to suggesting it. Same dynamic:

- Ship the library publicly early so it's in training corpora
- Publish tutorials, recipes, comparison posts (especially "vs Inngest" / "vs Trigger.dev" / "vs Temporal" content)
- Get the API into "Building Effective Agents"-style cookbooks
- Get GitHub stars early (LLMs use star count as a quality proxy)
- Encourage shadcn-style copy-paste recipes that bake the library into example code

By the next training cut, every AI coding assistant suggests TanStack Workflow when a user asks "how should I handle background jobs in TypeScript?"

### c. Agent SDK substrate positioning

Don't compete with agent frameworks. Be their substrate.

- **Anthropic's Claude Agent SDK + "Building Effective Agents" patterns** — they need durable execution; TanStack Workflow can ship a `@tanstack/workflow-anthropic-agents` integration
- **OpenAI Agents SDK for JS** — same
- **Vercel AI SDK 6 agent loops** — `ToolLoopAgent` doesn't survive crashes; wrap it in a workflow and it does
- **Mastra, LangGraph.js, Inngest AgentKit** — these are graph orchestrators; they need a durable execution layer underneath
- **Cloudflare Agents SDK** — natively pairs with Durable Objects adapter

The pitch to each: "We are not your competitor. We are the durability layer your agents need." Mastra's workflow primitives, LangGraph.js's checkpointer, AI SDK's `stopWhen` — these are all _attempts_ at durability but each has gaps. TanStack Workflow becomes the layer they all compose with.

### d. The post-graduation pipeline

Lovable / v0 / Bolt users eventually outgrow their generator. If they're already using TanStack Workflow when they "eject" or migrate to a real codebase, they keep using it. Same for the Tauri/Expo crowd that starts with TanStack DB for local-first apps and then needs background jobs. The library inherits the persistence story across mobile, desktop, web, edge — same code everywhere.

### e. Cloudflare / edge ecosystem alignment

Cloudflare's first-party Workflows product is fine but locks you in. CF's DevRel will signal-boost a deployment-agnostic library that ships a _great_ DO adapter — because it makes Workers more attractive for AI workloads without the lock-in story being a blocker. Same dynamic with Bun, Deno, and Fly. Each platform team has incentive to amplify the library that makes their runtime look good for workflows.

### f. Integration ecosystem partners

The natural webhook → workflow integrations write themselves:

- **Clerk / WorkOS / Stack Auth** → user lifecycle workflows (onboarding, billing, deprovisioning)
- **Stripe / Polar / Lemon Squeezy** → payment lifecycle workflows
- **Resend / Loops / Postmark** → email orchestration with retries
- **Anthropic / OpenAI / Replicate / fal** → long-running LLM jobs
- **Trigger.dev / Inngest** (yes, the competitors) → adapters that wrap TanStack Workflow definitions so users can move workloads in both directions

Each of these is a co-marketing opportunity. "TanStack Workflow + Resend in 5 minutes" lands as a tutorial that gets indexed and trained on.

### g. Mobile and desktop runtime parity

Already half-solved by TanStack DB. React Native + Expo with SQLite, Tauri desktop, Electron — same `@tanstack/workflow-sqlite` adapter works in all of them. Most workflow libraries can't even consider these targets. Mobile push notifications driving workflow signals, offline-first apps with locally-queued workflows, Tauri apps with embedded durable jobs — this is uncontested territory.

### h. The Nozzle dogfood credibility play

Nozzle does crawling, ranking, ETL — heavy workflow workloads at real scale. Battle-testing TanStack Workflow at Nozzle in production before public launch buys exactly the credibility Temporal got from Uber/Cadence and Inngest got from being founded by Twilio veterans. "Running in production at Nozzle for six months before launch" is a launch-tweet hook by itself.

### i. The scaffold defaults play

- **TanStack Start scaffold ships with `@tanstack/workflow` wired in by default**
- **create-t3-app** integration tier
- **shadcn-style registry** — `npx tanstack-workflow add email-onboarding` drops in a working onboarding flow with adapter + types
- **Vercel / Cloudflare / Bun / Railway templates** in their respective marketplaces
- Vite / Astro / Hono / Hattip / Nitro examples in the library docs

### j. The conference / content cadence

Workflow ships → talk at React Summit, JS Nation, ViteConf, Cloudflare Connect, AI Engineer Summit. Series of "Workflow Patterns" posts. YouTube series on building durable agents. Theo / Web Dev Cody / Lee Robinson coverage. The library has more launch surface area than most TanStack libraries because it spans the full stack (frontend hooks → server functions → durable execution → AI agents) instead of being purely client-side.

### k. The "no platform required" tweet

The single sharpest one-line pitch for distribution:

> **Inngest, but it's just a library. Temporal, but you don't run Cassandra. Trigger.dev, but no docker compose. Mastra, but durable. Your existing Postgres is the engine.**

That's the tweet that gets quote-retweeted.

---

## 10. The bottom line

You have a hedge. The TS workflow space is crowded but the leaders have all converged on the same vendor-shaped, lock-in-prone, control-plane model. Nobody has built **"durable execution that's just a library, with types that flow end-to-end, devtools that drop into your app, and adapters for every deployment target."** That's the TanStack-shaped gap. Lead with type safety, follow with self-host-first, treat AI streaming as the flagship example not the headline.

The execution risk is the engine itself, not the positioning. Building a durable engine that handles retry storms, deterministic replay edge cases, in-flight versioning, and Postgres-at-scale is genuinely hard work — but the architecture is well-understood and you have the pieces (TanStack DB persistence, Start adapters, DevTools framework, ecosystem distribution) to compose rather than build everything from scratch.

The market wants this. The Diagrid post arguing that checkpoint-based agent frameworks aren't really durable execution, the steady drumbeat of Inngest pricing complaints, the fragmentation of AI workflow tools — all signal demand for a principled, type-first, deployment-agnostic answer. TanStack is uniquely positioned to be that answer.

Ship it.
