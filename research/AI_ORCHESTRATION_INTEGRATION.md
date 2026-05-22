# `@tanstack/ai-orchestration` ↔ `@tanstack/workflow-core` integration

What can be reliably removed from [TanStack/ai#542](https://github.com/TanStack/ai/pull/542) now that `@tanstack/workflow-core@0.0.1` is live, and how the AI APIs there compose with the shipping engine.

PR head as of writing: `3a51d7b`.

## TL;DR

**Path B — refactor `ai-orchestration` to sit on top of `@tanstack/workflow-core`.** Sheds 18 of 25 source files; the AI layer narrows to: `defineAgent`, `defineOrchestrator`, `defineRouter`, the `invokeAgent` shape-detector helper, an `agentTypes`/`types.ts` for AI-only declarations, and (optional) a `withAgents` middleware that adds `ctx.agent(stepId, def, input)` for ergonomic invocation.

The shape difference is real: PR 542 ships a generator-based engine (`async function*` + `yield* agents.x(input)` + `StepDescriptor` union); workflow-core ships a closure engine (`async (ctx)` + `await ctx.step('id', fn)`). Closure-based AI integration is the simpler direction.

**No workflow-core engine changes are strictly required** — closure-over-`ctx` is enough for step bodies to forward agent streams via `ctx.emit`. One small affordance (a typed `ctx.agent` middleware) would polish the DX but isn't a blocker.

## The shape mismatch

|                       | `ai-orchestration` today                                                                                    | `workflow-core`                                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Workflow function     | `async function* run({ input, state, agents, emit, signal })`                                               | `async (ctx) => ...`                                                                |
| Side-effect primitive | `yield* step('id', fn)`                                                                                     | `await ctx.step('id', fn)`                                                          |
| Agent invocation      | `yield* agents.writer(input)` (via `bindAgents`)                                                            | n/a — must be ported                                                                |
| Engine consumes       | `StepDescriptor` union (`agent`, `step`, `signal`, `approval`, `now`, `uuid`, `nested-workflow`, `patched`) | Method calls on `ctx`                                                               |
| Pause mechanism       | Generator yields pause descriptor → engine writes RunState + closes stream                                  | Primitive throws `WorkflowPaused` sentinel → engine writes RunState + closes stream |

The two engines drive workflows fundamentally differently. They can coexist as two libraries, but they can't share the runtime path.

## Three integration options

### A. Two engines coexist

Leave `ai-orchestration` on its own generator engine; ship `workflow-core` separately. Maybe share a few types (`SchemaInput`, `InferSchema`).

- **Pro:** Zero refactor cost for ai-orchestration. PR 542 lands as-is.
- **Con:** Two engines means two truths for the same concepts (replay rules, log shape, idempotency, run-state schema, version routing). Bug fixes diverge. Storage adapters have to be written twice. Supply-chain surface doubled.
- **Verdict:** Don't pick this. The whole point of extracting `workflow-core` was to consolidate.

### B. Refactor ai-orchestration onto workflow-core (RECOMMENDED)

`ai-orchestration`'s engine code goes away. `defineAgent` and `defineOrchestrator` survive as AI-flavored sugar that produce `workflow-core` workflow definitions internally.

- **Pro:** One engine, one truth. Storage adapters and devtools written once. AI layer is genuinely a layer.
- **Con:** Real refactor of ai-orchestration — most of the engine + primitives files get deleted. PR 542's reviewers see a smaller, AI-focused diff.
- **Verdict:** Take this path.

### C. Ship both engine flavors in workflow-core

`workflow-core` exposes both a closure API (current) and a generator API (ported from PR 542). `ai-orchestration` picks the generator flavor.

- **Pro:** ai-orchestration's existing API is preserved verbatim.
- **Con:** workflow-core becomes the union of two engine paradigms. Doubles surface area, doubles test matrix, doubles bug-fix work. Users have to pick a flavor. Migration story is muddier than just adopting closures.
- **Verdict:** Don't pick this.

## What can be reliably removed from PR 542

Assuming Path B. These files have a direct equivalent in `@tanstack/workflow-core@0.0.1` and become re-exports or just deletions.

### Delete entirely (18 files)

| File                                | Replaced by                                                             |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `src/engine/run-workflow.ts`        | `runWorkflow` from `@tanstack/workflow-core`                            |
| `src/engine/fingerprint.ts`         | `workflow-core` (deprecated; explicit versioning preferred)             |
| `src/engine/state-diff.ts`          | `workflow-core` (identical)                                             |
| `src/engine/emit-events.ts`         | `workflow-core`'s `WorkflowEvent` shape                                 |
| `src/run-store/in-memory.ts`        | `inMemoryRunStore` from `workflow-core`                                 |
| `src/server/parse-request.ts`       | `parseWorkflowRequest` from `workflow-core`                             |
| `src/server/index.ts`               | re-export                                                               |
| `src/registry/select-version.ts`    | `selectWorkflowVersion` / `createWorkflowRegistry` from `workflow-core` |
| `src/result.ts`                     | `succeed` / `fail` from `workflow-core`                                 |
| `src/define/define-workflow.ts`     | `createWorkflow` from `workflow-core`                                   |
| `src/primitives/step.ts`            | `ctx.step`                                                              |
| `src/primitives/sleep.ts`           | `ctx.sleep` / `ctx.sleepUntil`                                          |
| `src/primitives/wait-for-signal.ts` | `ctx.waitForEvent`                                                      |
| `src/primitives/approve.ts`         | `ctx.approve`                                                           |
| `src/primitives/now.ts`             | `ctx.now`                                                               |
| `src/primitives/uuid.ts`            | `ctx.uuid`                                                              |
| `src/primitives/retry.ts`           | `retry` from `workflow-core` (free function)                            |
| `src/primitives/patched.ts`         | Drop — replaced by `previousVersions` routing                           |
| `src/primitives/bind-agents.ts`     | Drop — agents become plain objects with `.invoke(...)`                  |

Plus most tests under `tests/` — `workflow-core` already covers the engine, durability, retry, timeout, idempotency, CAS, signals, primitives, in-memory-store, registry, parse-request, state-diff. The agent-specific ones (smoke uses agents heavily, durability, attach, publisher) get rewritten against the new shape.

### Keep + refactor (5-7 files)

| File                                            | What changes                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/define/define-agent.ts`                    | Agent shape changes from `run: → AgentRunResult` (returned to the generator engine) to `invoke(input, { emit, signal }): Promise<T> \| AsyncIterable<StreamChunk> \| { stream, output }` (called directly from a step body). Three-shape detection stays; just moves call site.              |
| `src/engine/invoke-agent.ts`                    | Keep as a pure helper. Called from inside a `ctx.step(...)` body in user code (or from the `withAgents` middleware). The three-shape detection + stream filtering + output parsing logic is genuinely AI-specific and not in workflow-core.                                                  |
| `src/define/define-orchestrator.ts`             | Rewritten as a thin wrapper around `createWorkflow().handler(async (ctx) => { /* router loop */ })`. The router itself stays as a function returning `RouterDecision`; instead of `yield*`-ing it inside a generator, it's called as `await router({...})` inside the closure.               |
| `src/define/define-router.ts`                   | Mostly intact — types-only helper. The router signature drops the `StepGenerator` return wrapping; it returns `Promise<RouterDecision>`.                                                                                                                                                     |
| `src/types.ts`                                  | Strip everything engine-shaped (StepDescriptor, StepGenerator, RunState, RunStore, etc. — those re-export from `workflow-core`). Keep AI-only types: `AgentDefinition`, `AgentRunArgs`, `AgentRunResult`, `AgentMap`, `BoundAgents`, `SchemaInput`-related helpers if AI uses them directly. |
| `src/index.ts`                                  | Public surface narrows to: `defineAgent`, `defineOrchestrator`, `defineRouter`, `invokeAgent`, `SchemaValidationError`, agent-related types. Re-exports from `workflow-core` for convenience.                                                                                                |
| `src/middleware/with-agents.ts` (new, optional) | Provides a typed `ctx.agent(stepId, agentDef, input)` primitive via `createMiddleware` from `workflow-core`. Wraps `invokeAgent` + `ctx.step`. Pure ergonomic sugar.                                                                                                                         |

### Add

- `dependencies: { "@tanstack/workflow-core": "^0.0.1" }` to `package.json`.
- Keep `peerDependencies: { "@tanstack/ai": "workspace:*" }` for the StreamChunk + chat APIs.

### Net result

```
Before:  25 src files + 16 tests
After:   ~6 src files + ~6 AI-specific tests
```

## Gaps in workflow-core (if any) for hosting the agent layer

Walked through Alem's article + orchestrator demos and Kyle's expense + AI-agent + durable-agent examples. **Zero engine changes are strictly required.** Three observations worth noting:

**1. Streaming side-effects from inside a step.** Agents return AG-UI chunks during execution. Today, a step body is just a callback that returns a value. To forward chunks: the step body closes over `ctx`, so `ctx.emit('chunk', chunk)` works inline. No engine change needed.

```ts
const result = await ctx.step('writer', async () => {
  const { stream, output } = invokeAgent(writer, input, ctx.emit, ctx.signal)
  for await (const chunk of stream) ctx.emit(chunk.type, chunk as any)
  return output
})
```

Slight wart: looks like two `ctx.emit` plumbings (one passed to `invokeAgent`, one in the loop). `invokeAgent`'s `emit` argument is the agent's own emit hook for custom events; the stream-forwarding emit is separate. The `withAgents` middleware below hides this.

**2. Re-emit on replay.** When a step's result is cached, the chunks aren't re-emitted. A fresh attach sees `STEP_FINISHED` with the cached result, no inner deltas. This matches PR 542's behavior today ("per-token streaming history is not persisted; on attach mid-step the client sees STEP_STARTED with no prior tokens and then live tokens from the attach point onward"). No regression.

**3. Nested workflows.** PR 542's engine has a `nested-workflow` step descriptor. workflow-core does not. To "nest" workflows under the closure engine, call `runWorkflow({ workflow: child, ... })` from inside a step. The child consumes a fresh `runId` and is independent. Acceptable — orchestration doesn't need true nesting, and helpers wanting it can build it themselves in 20 lines.

## Optional polish: `withAgents` middleware

Adds `ctx.agent(stepId, agentDef, input)` to ctx. Pure sugar over `ctx.step` + `invokeAgent`. Lives in `ai-orchestration`, opt-in via middleware.

```ts
// In ai-orchestration:
export const withAgents = createMiddleware().server<{
  agent: <TInput, TOutput>(
    stepId: string,
    def: AgentDefinition<unknown, unknown, string>,
    input: TInput,
  ) => Promise<TOutput>
}>(async ({ ctx, next }) => {
  return next({
    context: {
      agent: (stepId, def, input) =>
        ctx.step(stepId, async () => {
          const { stream, output } = invokeAgent(
            def,
            input,
            ctx.emit,
            ctx.signal,
          )
          for await (const chunk of stream) {
            ctx.emit(chunk.type, chunk as unknown as Record<string, unknown>)
          }
          return output
        }),
    },
  })
})
```

User code:

```ts
import { withAgents } from '@tanstack/ai-orchestration'
import { createWorkflow } from '@tanstack/workflow-core'

const article = createWorkflow({
  id: 'article',
  input: z.object({ topic: z.string() }),
})
  .middleware([withAgents])
  .handler(async (ctx) => {
    const draft = await ctx.agent('writer', writerAgent, {
      topic: ctx.input.topic,
    })
    const review = await ctx.agent('legal', legalAgent, { draft })
    if (review.verdict === 'block')
      return fail(`legal: ${review.findings.join('; ')}`)
    const decision = await ctx.approve({ title: 'Publish?' })
    if (!decision.approved) return fail('user denied')
    return succeed({ article: draft })
  })
```

This reads identically in vibe to Alem's original generator-style code, just with `await ctx.agent(id, def, input)` instead of `yield* agents.name(input)`.

## Concrete before/after on one workflow

**Alem's article workflow today (PR 542 generator engine):**

```ts
const articleWorkflow = defineWorkflow({
  name: 'article',
  input: ArticleInput,
  output: ArticleOutput,
  state: ArticleState,
  agents: { writer, legal, editor },
  run: async function* ({ input, state, agents }) {
    state.phase = 'drafting'
    const draft = yield* agents.writer({ topic: input.topic })
    state.draft = draft
    const review = yield* agents.legal({ draft })
    if (review.verdict === 'block')
      return fail(`legal: ${review.findings.join('; ')}`)
    const decision = yield* approve({ title: 'Publish?' })
    if (!decision.approved) return fail('user denied')
    return succeed({ article: draft })
  },
})
```

**Same workflow, ported (post-refactor):**

```ts
const articleWorkflow = createWorkflow({
  id: 'article',
  input: ArticleInput,
  output: ArticleOutput,
  state: ArticleState,
})
  .middleware([withAgents])
  .handler(async (ctx) => {
    ctx.state.phase = 'drafting'
    const draft = await ctx.agent('writer', writer, { topic: ctx.input.topic })
    ctx.state.draft = draft
    const review = await ctx.agent('legal', legal, { draft })
    if (review.verdict === 'block')
      return fail(`legal: ${review.findings.join('; ')}`)
    const decision = await ctx.approve({ title: 'Publish?' })
    if (!decision.approved) return fail('user denied')
    return succeed({ article: draft })
  })
```

Two changes per call site: `yield*` → `await`, plus the agent reference now takes the step id as a first arg. Otherwise structurally identical. The `agents` declaration disappears (agents are just imports). The `state` schema flows through `.middleware([withAgents])` because middleware accumulation preserves the base ctx.

## Estimated refactor cost

Rough order:

| Task                                                                                   | Files              | LoC delta | Time       |
| -------------------------------------------------------------------------------------- | ------------------ | --------- | ---------- |
| Delete the 18 engine/primitive files                                                   | -18 src, -10 tests | -3500     | half a day |
| Refactor `defineAgent` to closure-call shape                                           | 1 src              | small     | 1 hour     |
| Refactor `defineOrchestrator` to closure-based router loop                             | 1 src              | medium    | 2 hours    |
| Update `defineRouter` types                                                            | 1 src              | small     | 30 min     |
| Strip engine types from `types.ts`, keep AI types                                      | 1 src              | medium    | 1 hour     |
| Add `withAgents` middleware                                                            | 1 src + 1 test     | small     | 2 hours    |
| Update `index.ts` exports                                                              | 1 src              | trivial   | 15 min     |
| Add `@tanstack/workflow-core` dependency, build/test verify                            | configs            | trivial   | 30 min     |
| Rewrite AI-specific tests (smoke, durability, attach, publisher) against closure shape | ~4 tests           | medium    | 2-3 hours  |

**Net: one focused day of work** to land PR 542 as an AI-only library on top of `workflow-core`.

## Open questions

- **AG-UI event mapping.** Workflow-core emits `WorkflowEvent` (`RUN_STARTED`, `STEP_FINISHED`, etc.). AG-UI clients (devtools, `@tanstack/ai-react`'s `useWorkflow` hook) expect the AG-UI `StreamChunk` shape. The two are intentional structural cousins. A small `toAgUiChunk(event)` adapter in `ai-client` is probably the cleanest seam.
- **`@tanstack/ai-react`'s `useWorkflow` hook.** Currently expects the PR 542 engine's event stream. Will need to adapt to the workflow-core event shape (probably just the chunk-translation adapter above + `WorkflowEvent` → state reducer).
- **Backwards-compat shim?** The PR 542 branch hasn't shipped, so there are no consumers to compat-break. Clean cut.
- **Versioning.** `ai-orchestration` would land as its own pre-alpha (e.g., 0.0.1) once the refactor is done.

## Recommended sequence

1. **Land workflow-core 0.0.1** ✅ (done; on npm)
2. **Refactor PR 542 onto workflow-core** following the file list above. Single focused day.
3. **Cut `@tanstack/ai-orchestration@0.0.1`** alongside.
4. **`@tanstack/ai-react`'s `useWorkflow` hook** updates to the workflow-core event shape — separate PR.
5. **Devtools / attach UI** updates similarly.

Status: research only. Ready to execute when Tanner gives the word.
