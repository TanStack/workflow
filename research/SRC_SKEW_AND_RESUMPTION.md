# Source Skew & Resumption — What's There, What's Missing

> Detailed assessment of how `@tanstack/ai-orchestration` handles the two hardest durable-execution problems: source-code changes between deploys (skew) and resuming runs after process restarts. With a concrete punch list of what's missing.

## TL;DR

Alem's design uses the right **default** — strict fingerprint refusal, no silent corruption — but the **operational story for long-running workflows is undertold**. Three real gaps:

1. **Fingerprint is whitespace-sensitive** because it hashes `Function.prototype.toString()`. Prettier reformat, minifier choice, or build-tool bump → spurious mismatches → in-flight runs killed.
2. **Patched mode is correctness-by-discipline.** Nothing prevents a developer from adding a yield without wrapping it in `patched()`, which silently shifts positional indices for in-flight runs in patch-versioned mode.
3. **No automatic side-by-side version drain.** When fingerprint mismatches, runs error out. The `selectWorkflowVersion` registry exists but requires caller-supplied versioning and explicit deploy-pipeline integration — not automatic.

For workflows under 24 hours, this is fine. For 1–7 day workflows, manageable with discipline. For 30-day workflows, painful unless the gaps below are filled.

---

## What Alem actually built

### The fingerprint

Lives in `packages/typescript/ai-orchestration/src/engine/fingerprint.ts`. Computes a 64-bit FNV-1a hash (rendered as base36) covering:

- The workflow's `name`
- `run.toString()` — the entire run function source as text
- `initialize.toString()` if present
- Each declared agent's name + `run.toString()`
- Nested workflows recursively (with cycle detection via `WeakSet`)

Stored on the run record when it starts. On resume:

- Compute current fingerprint
- Compare to stored
- If different → emit `RUN_ERROR { code: 'workflow_version_mismatch' }` and **refuse to drive the generator**

The header comment is explicit:

> "Source strings come from `Function.prototype.toString()` — production builds may minify, so the fingerprint is sensitive to whitespace and symbol renaming. That's the conservative choice (Temporal does the same): false-positive mismatches force a redeploy decision rather than silently corrupting an in-flight run."

This is **the right default**. Refusing to drive a fresh generator through a log whose positional indices may no longer line up is far better than corrupting an in-flight workflow. Tanner's concern is valid; Alem's instinct is also right.

### The patched mode

Declaring `patches: ['change-name', ...]` on a workflow switches it into patch-versioned fingerprint mode:

- Fingerprint covers only `name + sorted patch list`, **not source text**
- Code-body changes no longer trigger `workflow_version_mismatch`
- User wraps changed code in `if (yield* patched('change-name')) { new } else { old }`
- `patched(name)` returns `false` for runs started before the patch was declared, `true` for runs started after
- The patches-subset check enforces: you can ADD patches across deploys but cannot REMOVE them while runs are in flight

This is the proven Temporal `getVersion()` / `patched()` pattern, faithfully reproduced.

### Cross-version registry

`createWorkflowRegistry()` + `selectWorkflowVersion()` lets you route runs to the right workflow version based on a caller-supplied identifier. Useful when running multiple versions side-by-side, but requires:

- Caller chooses + supplies the version at start time (`version: '2026-05-15'` in `defineWorkflow`)
- Both versions registered in memory simultaneously
- Routing logic in the host

There is no automatic deploy-pipeline integration that holds old code in memory after a deploy. That orchestration is on the user.

### Idempotency

The engine passes `ctx.id` to every `step` function — a deterministic per-step ID intended for use as an idempotency key with external systems. The docs explicitly mention this. CAS conflict handling exists for the engine's own write path. Client-provided `runId` + `signalId` close the loop on the API surface.

---

## Where it breaks — a failure-mode taxonomy

Let me enumerate every realistic source change and what happens under Alem's current design.

| #   | Source change                                    | Strict mode                                                   | Patch mode                                                      | What you actually want                       |
| --- | ------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| A   | Prettier reformat                                | **Spurious refusal** — all in-flight runs killed              | Survives                                                        | Survive                                      |
| B   | Minifier difference across builds                | **Spurious refusal**                                          | Survives                                                        | Survive                                      |
| C   | Add a `console.log`                              | **Spurious refusal**                                          | Survives                                                        | Survive                                      |
| D   | Edit a code comment                              | **Spurious refusal**                                          | Survives                                                        | Survive                                      |
| E   | Add yield in unreached branch                    | Correct refusal (safe)                                        | **Silent corruption risk** if branch later fires                | Detect + force `patched()`                   |
| F   | Add yield in active path                         | Correct refusal (safe)                                        | **Silent corruption**                                           | Detect + force `patched()`                   |
| G   | Rename a step's string ID                        | Correct refusal                                               | Silent corruption (string is positional metadata, not identity) | Position-stable, alias-friendly              |
| H   | Remove a yield                                   | Correct refusal                                               | **Silent corruption**                                           | Detect + force `patched()`                   |
| I   | Reorder yields                                   | Correct refusal                                               | **Silent corruption**                                           | Detect + force `patched()`                   |
| J   | Change an agent's system prompt                  | **Spurious refusal** (agent.run.toString() changes)           | Survives (excludes source)                                      | Survive — recorded LLM output replays anyway |
| K   | Change an agent's adapter (model swap)           | **Spurious refusal**                                          | Survives                                                        | Survive                                      |
| L   | Process restart, same code                       | Match, resume                                                 | Match, resume                                                   | Happy path ✓                                 |
| M   | Rolling deploy: new + old workers serve same run | **Spurious refusal** when run routes to new worker mid-flight | Survives if both have patches declared                          | Pin run to its version's worker pool         |
| N   | Schema added optional field                      | Spurious refusal                                              | Survives                                                        | Survive; new field absent on old runs        |
| O   | Schema added required field                      | Spurious refusal                                              | Survives but new field undefined in old runs                    | Migration-aware                              |
| P   | Throw different error message                    | **Spurious refusal**                                          | Survives                                                        | Survive                                      |
| Q   | Inline a helper function                         | **Spurious refusal**                                          | Survives if no new yields                                       | Survive                                      |

The pattern: **strict mode is too coarse — most changes that don't affect yield structure still kill in-flight runs. Patch mode is too permissive — most changes that affect yield structure silently corrupt unless the developer remembered to wrap them in `patched()`.**

Both regimes share the same root cause: **identity is positional, fingerprinting is textual.** Position drift causes corruption; text drift causes spurious refusal. Neither matches what we actually want, which is _structural_ identity that's resilient to formatting but precise to yield shape.

---

## The missing layer

Five concrete additions close the gaps. Each is independent; pick the ones that matter most.

### 1. AST-based fingerprint instead of source-text

Replace `Function.prototype.toString()` hashing with an AST walk that extracts:

- Number, position, and _kind_ of yields in the run function (`step`, `sleep`, `waitForSignal`, `approve`, agent call, `patched`)
- The string literals that name yields (`step('charge', ...)` → identity `step:charge`)
- For agent calls: the _key_ in `agents.foo`, not the agent's source
- For nested control flow: just count yields per branch; don't hash branch bodies
- For agents: name + input/output schema shape, not the prompt or implementation

Outcome:

- Cases A, B, C, D, J, K, P, Q (whitespace, minifier, comments, prompts, model swaps, formatting) → **survive**
- Cases E, F, G, H, I (any structural yield change) → **still refuse**, with a _specific_ error message: "yield #4 was `step:charge` in the original run but is now `step:charge-card`"
- Cases N, O (schema changes) → diffable, can warn vs error per-field

Implementation cost: ~300 LoC TypeScript AST walker. The TypeScript compiler API gives you everything you need; works at build time (preferred) or via `ts-morph` at runtime if needed.

### 2. Build-time fingerprint generation + pinning

Compute the fingerprint at build time, embed it in the bundle, ship it alongside the run record. Two wins:

- Eliminates "runtime fingerprint differs from runtime fingerprint" entirely (cross-build instability)
- Lets the deploy pipeline see "this build has fingerprint X" and decide whether to drain in-flight runs vs. take them over

Provide `@tanstack/workflow-vite`, `-swc`, `-esbuild`, `-rolldown` plugins that emit a `workflow-manifest.json` listing every workflow's fingerprint + structural shape. The host reads this at startup and registers known fingerprints for resume.

### 3. ESLint rule: enforce `patched()` for yield structure changes

A lint rule that runs in patch-versioned mode and:

- Tracks the previous build's structural yield manifest (committed to the repo, e.g. `.tanstack/workflow-manifest.json`)
- Detects added / removed / reordered yields
- Requires each change to be inside a `if (yield* patched('name')) { ... }` block
- Errors at lint time: "You added `yield* step('foo')` outside a `patched()` gate. In-flight runs will be corrupted. Either wrap it in `patched()` or accept that all in-flight runs of `article-workflow` will fail on resume."

This catches the patch-mode footgun before it ships. Without it, patch mode is correctness-by-discipline; with it, the toolchain enforces the discipline.

### 4. Automatic side-by-side version drain

Today: when a fingerprint mismatches, the run errors. The user can manually run multiple versions via `selectWorkflowVersion` if they thought to set it up.

Better default: the engine accepts a `previousVersions: [...]` array on `defineWorkflow` (or auto-detects them from a `previousManifests` directory):

```typescript
defineWorkflow({
  name: 'article-workflow',
  run: async function* (...) { ... },         // current
  previousVersions: [
    { fingerprint: 'old-fp-1', run: oldRun1 },
    { fingerprint: 'old-fp-2', run: oldRun2 },
  ],
})
```

The deploy pipeline (or the Vite plugin) can populate `previousVersions` from the last N committed manifests. On resume:

- Look up the run's stored fingerprint
- If it matches current → drive current
- If it matches a previous version → drive that previous version's code
- If it matches nothing → error (the run is truly orphaned)

In-flight runs continue on their original code; new runs use the latest. **No manual drain coordination required.**

After N days (configurable per workflow) the old code is dropped from the registry and any remaining runs error out. The engine surfaces a metric: "5 runs are still on fingerprint old-fp-1, expiring in 3 days."

### 5. Stuck-run inspector

When a run _does_ end up orphaned (fingerprint not matched anywhere), instead of just emitting `RUN_ERROR`, the engine should:

- Snapshot the partial state + step log into a separate "orphaned runs" store
- Expose an inspector API: list orphaned runs, show their last completed step, show the original input
- Provide three escape hatches:
  - **Abandon** — mark the run as dead, emit cleanup events
  - **Restart from scratch** — re-enqueue with the original input
  - **Manual advance** — operator picks "the run is conceptually at step N; please continue from there as if step N had succeeded with this value"

This is the human-in-the-loop safety net for when automation fails.

---

## How the layered story should read in docs

The library should be honest about the operational story per workflow duration tier:

### Tier 1: Workflows under 1 hour

> Ship code freely. In-flight runs at deploy time complete in minutes. Default strict mode is fine.

### Tier 2: Workflows 1 hour to 24 hours

> Default strict mode is fine. Use AST-based fingerprint (above) to avoid spurious refusals from formatting. Expect the occasional in-flight run to error on resume after a deploy that touches workflow source — accept that, or wait to deploy.

### Tier 3: Workflows 1 to 7 days

> Use patch-versioned mode + the ESLint rule. Plan code changes that touch workflow source through `patched()` gates. Use automatic side-by-side drain (`previousVersions`) so in-flight runs stay on their original code.

### Tier 4: Workflows over 7 days

> Use `selectWorkflowVersion` + explicit versioning + deploy-pipeline integration. Treat workflow code like a public API — versioned, with explicit migration paths. Plan for a year-long "long tail" of old-version runs after each significant change.

### Tier 5: Workflows over 30 days

> You're in Temporal territory. Either accept abandonment as a cost, or pre-plan every workflow change months in advance with `patched()` gates. The TanStack Workflow library can do this with discipline, but it's expensive operationally.

The library should refuse to silently make any tier "just work." It should make the operational requirements _visible_ per tier.

---

## What this means for the standalone library

The bottom line update in [PRIOR_ART_AI_ORCHESTRATION.md](PRIOR_ART_AI_ORCHESTRATION.md) said "productize and extend an existing internal workflow library — eight months instead of fourteen." That's still true, but the **extending** is more substantial than the inventory implied:

**Engine-level additions (the new repo should ship these):**

1. AST-based fingerprint engine (replaces or augments source-text fingerprint)
2. Build-time fingerprint plugins (Vite / SWC / esbuild / Babel / Rolldown)
3. `previousVersions` auto-drain registry on `defineWorkflow`
4. ESLint plugin: `@tanstack/eslint-plugin-workflow` with `enforce-patched-on-yield-change` rule
5. Orphaned-run inspector + escape-hatch API
6. Documented operational tier guide

**Adapter ecosystem (already in PRIOR_ART_AI_ORCHESTRATION.md):**

7. Storage adapters: postgres / sqlite / d1 / durable-object / redis
8. Runtime adapters: cron / worker / do-alarm
9. Framework bindings: solid / vue / svelte
10. Start integration
11. Devtools

The engine work is the harder half. The skew + resumption story is what differentiates a credible production durable-execution library from a clever prototype. Temporal earned its reputation by being unimpeachable on these axes. TanStack Workflow has to clear the same bar.

**Good news:** Alem's design is correct on the defaults (refusal-first). The work above is additive, not corrective. It strengthens an already-sound foundation.

**Honest news:** This work is real. Two to three months of engine engineering, on top of the adapter ecosystem build-out. Worth doing right; not worth shipping half-done.

---

## Conversation to have with Alem

In addition to the questions in [PRIOR_ART_AI_ORCHESTRATION.md](PRIOR_ART_AI_ORCHESTRATION.md):

1. **What's the intended operational story for >24h workflows?** Is the AI use case mostly request-scoped (a single user session), in which case strict mode is enough? Or are there 7-day+ pipelines on his roadmap?
2. **Has he hit the whitespace-sensitivity issue in practice yet?** If the existing test suite exercises real deploys, he'd know whether spurious refusals are a problem.
3. **Open to AST-based fingerprinting?** The implementation cost is real but the operational win is large. Probably a multi-week project.
4. **What's missing from the patch-mode footguns list above?** He's lived in this code for 10 days; he knows the edges better than I do from a 30-minute read.
5. **Build-tool integration appetite.** Vite plugin for build-time fingerprinting + lint manifest export is the natural next step. Worth doing in `ai-orchestration` or in the new workflow repo?

The strategic shape doesn't change. The new repo extracts + extends. The extending is just bigger and more important than the inventory alone suggested.
