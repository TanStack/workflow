# Prior Art: `@tanstack/ai-orchestration`

> **Critical finding.** Alem Tuzlak and Tom Beckenham have built a substantial generator-based workflow engine inside the TanStack AI repo over the last ten days (May 10–20, 2026). It lives on the `feat/durable-workflows` branch and is not yet merged or released. This document inventories what's there and updates the design recommendation in [API_CANDIDATES.md](API_CANDIDATES.md).

## Location

- Branch: `origin/feat/durable-workflows`
- Package: `packages/typescript/ai-orchestration/` in `github.com/TanStack/ai`
- Sibling integrations: `ai-client/src/workflow-client.ts`, `ai-react/src/use-workflow.ts`
- Working example: `examples/ts-react-chat/src/lib/workflows/article-workflow.ts`
- Doc: `docs/getting-started/workflows.md` (Tom shipped this earlier today)
- Status: package README says **"v0 prototype"**

## API shape — generator-based

Alem landed on the **async-generator** pattern that my candidates research considered briefly and dismissed as "too divergent." It works beautifully here. The workflow body is a normal `async function*`; `yield*` is how you call durable primitives.

```typescript
import {
  approve,
  defineAgent,
  defineWorkflow,
  fail,
  succeed,
} from '@tanstack/ai-orchestration'

const articleWorkflow = defineWorkflow({
  name: 'article',
  input: z.object({ topic: z.string() }),
  output: z.union([
    z.object({ ok: z.literal(true), article: Draft }),
    z.object({ ok: z.literal(false), reason: z.string() }),
  ]),
  state: z.object({
    phase: z.enum([
      'drafting',
      'reviewing',
      'editing',
      'awaiting-approval',
      'done',
    ]),
    draft: Draft.optional(),
  }),
  agents: { writer, legal, editor },
  run: async function* ({ input, state, agents }) {
    state.phase = 'drafting'
    const draft = yield* agents.writer({ topic: input.topic })
    state.draft = draft

    state.phase = 'reviewing'
    const review = yield* agents.legal({ draft })
    if (review.verdict === 'block')
      return fail(`legal: ${review.findings.join('; ')}`)

    state.phase = 'awaiting-approval'
    const decision = yield* approve({ title: 'Publish?' })
    if (!decision.approved) return fail('user denied')

    state.phase = 'done'
    return succeed({ article: draft })
  },
})
```

The full article-workflow.ts example exercises: typed input/output/state, three agents, schema-validated agent outputs, approval pauses with free-text feedback, a revision loop with `for` and `if`, discriminated-union return via `succeed`/`fail`.

## What's already shipped

### Definitions

- `defineAgent({ name, input, output, run })` — typed wrapper around any text/JSON producer (typically `chat()` from `@tanstack/ai`)
- `defineWorkflow({ name, version, input, output, state, agents, initialize, defaultStepRetry, patches, run })` — compose agents into a generator
- `defineOrchestrator({ ... })` — router-driven agent loop (alt shape for "agent picks next agent")
- `defineRouter({ ... })` — orchestrator routing decisions

### Generator primitives (all `yield*`-able)

- `step(name, fn, { retry, timeout })` — durable side effects; engine journals the return value; replay short-circuits
- `sleep(duration)` / `sleepUntil(date)` — durable timers
- `waitForSignal(name, options)` — pause for external event with optional timeout
- `approve({ title, description })` — typed human-in-the-loop pause; returns `{ approved, feedback }`
- `now()` — deterministic timestamp (journaled per call)
- `uuid()` — deterministic ID (journaled per call)
- `patched(name)` — Temporal-style mid-flight workflow migration gate
- `retry(generator, options)` — wrap a sub-generator in a retry policy
- `bindAgents()` — internal, binds agent map to ctx
- `succeed(data)` / `fail(reason)` — discriminated result helpers

### Engine internals

- `runWorkflow(definition, options)` — server-side execution entrypoint
- Replay engine that survives process restart
- Fingerprint-based source-change detection (refuses replay across workflow source changes unless `patches` is declared)
- CAS conflict handling for multi-instance routing — idempotent retry + signal_lost detection
- Per-step + workflow-level retry policies with backoff
- Per-step timeout with AbortSignal propagation
- Publisher hook for multi-node event fan-out
- State diff via hand-rolled JSON Patch (RFC 6902) — streams to clients between yields
- Split `RunStore` interface: state + step log

### Client surface

- `WorkflowClient` in `@tanstack/ai-client` — headless client with `start`, `attach`, `signal`, `approve`, `stop`
- Client-provided `runId` + `signalId` for idempotency
- Connection adapter pattern: `WorkflowConnectionAdapter` (e.g. `fetchWorkflowEvents('/api/workflow')`)
- `attach(runId)` — resubscribe to a running workflow from a different client
- `steps-snapshot` API for catching up on history

### React binding (`useWorkflow` in `@tanstack/ai-react`)

```typescript
const wf = useWorkflow<TInput, TOutput, TState>({
  connection: fetchWorkflowEvents('/api/workflow'),
})

// Returns: { state, output, status, start, stop, attach, signal, approve }
```

Stable client identity (mirrors `useChat` memo pattern). State updates stream in via JSON Patch.

### Server surface

- `parseWorkflowRequest(req)` — parses incoming workflow HTTP requests
- Composable with any HTTP framework (Start, Hono, Express, etc.)

### Cross-version registry

- `createWorkflowRegistry()` + `selectWorkflowVersion()` — routes incoming runs to the right workflow version based on a caller-supplied version identifier

### Run store

- `inMemoryRunStore()` — bundled for dev/tests
- `RunStore` interface for plugging in Postgres / SQLite / DO / Redis adapters (not yet implemented — this is the obvious next layer)

### Test coverage (12 test files)

`engine.attach.test.ts`, `engine.cas.test.ts`, `engine.durability.test.ts`, `engine.idempotency.test.ts`, `engine.patched.test.ts`, `engine.primitives.test.ts`, `engine.publisher.test.ts`, `engine.retry.test.ts`, `engine.signals.test.ts`, `engine.smoke.test.ts`, `engine.timeout.test.ts`, `in-memory-store.test.ts`, `registry.test.ts`.

## Where it overlaps with my Candidates document

This is essentially **a fourth candidate that I considered and dismissed too quickly**: generator-based workflows. My durable-execution research did cover it as "coroutine / async-state-machine compilation" (the Azure Durable Functions pattern), and I noted that `yield` is conceptually clean but TS inference through `yield` is awkward. Alem's implementation proves both points:

- ✅ `yield*` is genuinely clean — every yield is a checkpoint boundary, no AST transform needed
- ✅ Step identity is determined by yield position, so renames don't break in-flight runs
- ✅ Determinism contract is built-in: anything not yielded is pre-yield user code, anything yielded is journaled
- ⚠️ TS inference through generators still has rough edges, but the `AsyncGenerator<StepDescriptor, TOutput, unknown>` return type plus careful generic threading make `yield* agents.writer({ topic })` infer the agent's output type correctly
- ⚠️ Mistyping `yield` instead of `yield*` is a real footgun — the README and docs both call this out explicitly

The generator pattern delivers most of what my Candidate 3 (implicit context + build transform) was reaching for, **without requiring a build transform**. That's a strict improvement.

## Where it sits vs my candidates

| Trait                       | My C1                            | My C2                            | My C3                         | `ai-orchestration`                               |
| --------------------------- | -------------------------------- | -------------------------------- | ----------------------------- | ------------------------------------------------ |
| Definition style            | Object config                    | Builder chain                    | Plain function                | Object config                                    |
| Step identity               | String labels                    | String labels                    | Lexical AST position          | Generator yield position                         |
| Context threading           | Explicit `ctx`                   | Explicit `ctx`                   | AsyncLocalStorage + transform | Generator delegation via `yield*`                |
| Build transform needed      | No                               | No                               | Yes                           | No                                               |
| Step rename safety          | Footgun (mitigated by transform) | Footgun (mitigated by transform) | Safe                          | Safe — yield position is structural              |
| Composability               | OK (ctx threading)               | OK + middleware                  | Excellent                     | Excellent (sub-generators compose)               |
| Type safety                 | Strong                           | Strong                           | Strong                        | Strong (with `AsyncGenerator` generic threading) |
| `yield`-vs-`yield*` footgun | N/A                              | N/A                              | N/A                           | Yes (documented)                                 |

The `ai-orchestration` design is essentially **the best of Candidates 1 and 3 without the build transform cost**. The cost is the generator footgun, which is a real but smaller tax than maintaining a build-tool plugin matrix.

## What's not there yet (the obvious next layer)

The engine is excellent. The adapter ecosystem is the gap:

1. **Storage adapters.** Only `inMemoryRunStore`. No Postgres, SQLite, D1, Durable Objects, or Redis adapter yet. The `RunStore` interface looks clean and pluggable.
2. **Runtime adapters.** Currently the engine runs in-process. No cron-driven, worker-driven, or DO-alarm runtime modes for serverless / actor deployments.
3. **Framework bindings beyond React.** Only `@tanstack/ai-react`. No Solid, Vue, Svelte bindings yet (though `ai-solid-ui`, `ai-vue-ui` exist for the chat side).
4. **Devtools.** Nothing dedicated. The JSON Patch state streaming is the substrate but no inspector / timeline / replay-debugger UI.
5. **Start integration.** No `@tanstack/workflow-start` shim yet — users wire `parseWorkflowRequest` into route handlers manually.
6. **Storage-level transparency.** No documented schema / SQL examples for `RunStore` implementations — needed for the "you can `SELECT *` against it" positioning.
7. **Saga / compensation primitive.** Not present yet (though it composes naturally as a `try/finally` over sub-generators).
8. **Parallel / fan-out primitive.** Not yet — users would write `Promise.all` over generator drivers manually. A `parallel()` or `race()` primitive would be a natural addition.
9. **Child workflow invocation.** I didn't see `invoke(otherWorkflow)` — agents are the composition unit. Sub-workflow composition may not be needed if `agents.*` covers it, but cross-version routing across true child workflows would be a future need.

## Updated strategic recommendation

The standalone `@tanstack/workflow` library question is no longer "what API design?" — it's "**what's the relationship to `ai-orchestration`?**"

Three viable paths:

### Path A — Extract: promote the engine to `@tanstack/workflow-core`

`ai-orchestration` keeps the AI-flavored layer (agents, chat integration, state streaming for AI UIs). The pure engine — `defineWorkflow`, the primitives, the run store, the replay engine, the server — moves into `@tanstack/workflow-core`. `ai-orchestration` declares it as a peer dep and adds the agent/chat layer on top.

**Pros:**

- Single engine, no duplication
- Workflow code without AI agents becomes idiomatic (no more `agents: {}` on every definition)
- AI users continue to use `ai-orchestration` which adds the agents + chat sugar
- Adapter ecosystem (postgres, sqlite, do, redis, devtools, framework bindings) attaches to the core, benefits both

**Cons:**

- Refactor work — Alem's engine isn't packaged for extraction yet
- API churn for `ai-orchestration` users (who don't exist yet — it's v0)

**Recommendation: this is the right path.** The engine is too good to fork. The "agents required in defineWorkflow" coupling is the only thing that needs unwinding, and it's mechanical.

### Path B — Promote: rename `ai-orchestration` to `@tanstack/workflow`

Make agents optional. Drop the AI-specific framing. The package is just "TanStack Workflow" and agents become one of several integrations (alongside future storage adapters and framework bindings).

**Pros:**

- Cleanest end state
- One package, one engine, one positioning story
- Agents become a sub-feature, not the headline

**Cons:**

- Forces a position before there are users — but since it's v0, this is the _easiest_ time to do it
- Coordination with Alem on package name + AI repo vs. dedicated `workflow` repo

**Recommendation: do this if you're willing to merge `workflow` into `ai` (or vice versa).** Cleanest, but a structural call.

### Path C — Build parallel and replace later

Ship a new `@tanstack/workflow` separately. Let `ai-orchestration` continue as is. Plan migration later.

**Recommendation: don't.** Wasteful — Alem's engine is ahead of where any fresh re-implementation would be in three months.

### My pick

**Path A**, extract the engine into `@tanstack/workflow-core`, keep `ai-orchestration` as the AI-flavored layer, and use the empty `/Users/tannerlinsley/GitHub/workflow` repo to house the core + the storage/runtime adapter ecosystem + devtools + non-React framework bindings + Start integration.

The package layout becomes:

```
@tanstack/workflow-core          (extracted from ai-orchestration)
@tanstack/workflow-postgres
@tanstack/workflow-sqlite
@tanstack/workflow-d1
@tanstack/workflow-durable-object
@tanstack/workflow-redis
@tanstack/workflow-cron          (runtime adapter)
@tanstack/workflow-worker        (runtime adapter)
@tanstack/workflow-start         (HTTP entry for Start)
@tanstack/workflow-devtools
@tanstack/react-workflow         (extracted from ai-react)
@tanstack/solid-workflow
@tanstack/vue-workflow
@tanstack/svelte-workflow
@tanstack/ai-orchestration       (stays as the AI agents + chat layer on top)
```

## Conversation to have with Alem

1. **Was `ai-orchestration` designed as the future of `@tanstack/workflow` or specifically scoped to AI?** The README says "Generator-based workflows and orchestrators for TanStack AI" — but the primitives (step, sleep, waitForSignal, approve) aren't AI-specific. Worth confirming intent.
2. **How married are you to the `agents` parameter being required in `defineWorkflow`?** Making it optional unlocks the broader workflow market without breaking AI users.
3. **What's the next 30 days of roadmap on `ai-orchestration`?** If storage adapters and devtools are on his plate, coordinate. If not, the new repo can take them.
4. **Where should adapter packages live?** AI repo (alongside `ai-orchestration`)? Workflow repo? Cross-repo monorepo?
5. **Has the generator-vs-async-await design been pressure-tested with non-AI workloads?** ETL pipelines, payment processing, transactional sagas — the article-workflow example is rich but it's AI-shaped.

## Updated bottom line

The strategic position changes from **"design and build a workflow library"** to **"productize and extend an existing internal workflow library."** That's a much better starting position. Six months of work on the API shape, engine semantics, replay logic, idempotency, CAS, fingerprinting, and patched migrations is already in. What remains is the surrounding ecosystem — storage adapters, runtime adapters, framework bindings, devtools, deployment matrix, marketing positioning — which is exactly where TanStack's distribution and design strengths shine.

This is faster to market and lower-risk than a from-scratch build. It also keeps the headline pitch intact: type-safe durable workflows, deployment-agnostic, headless, no SaaS lock-in, devtools included.
