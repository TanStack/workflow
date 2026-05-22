# Explicit Versioning — Drop the Fingerprint, Lock the Content

> Alternative design: instead of runtime fingerprinting, require explicit versions on every workflow, keep old versions alive in the registry alongside current, and use a build-time lock file to detect accidental modification. Cleaner, simpler, and eliminates the spurious-refusal problem entirely.

## The core idea

A workflow declares its version explicitly. Every run is pinned to a version at start. Old versions stay loaded alongside the current one until they drain. The developer's job is to bump the version when behavior changes; the toolchain's job is to catch them when they forget.

```typescript
export const onboard = defineWorkflow({
  name: 'onboard',
  version: 'v3',
  previousVersions: [
    { version: 'v1', run: onboardV1Body },
    { version: 'v2', run: onboardV2Body },
  ],
  input: z.object({ userId: z.string() }),
  agents: { ... },
  run: async function* ({ input, agents }) {
    // current behavior
  },
})
```

That's the whole mechanic. No `patched()`. No fingerprint. No AST walker. No spurious refusals.

## Why this is better than fingerprinting

Alem's current design tries to _detect_ skew. This design tries to _prevent_ it.

| Concern                                                         | Fingerprint approach                                     | Explicit-version approach                             |
| --------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| Prettier reformat kills runs                                    | Yes (whitespace-sensitive)                               | No — version didn't change                            |
| Comment / log change kills runs                                 | Yes                                                      | No                                                    |
| Cross-build minifier drift                                      | Yes                                                      | No                                                    |
| Adding behavior to active path silently corrupts in-flight runs | Patch mode: yes                                          | No — old version still resumes                        |
| Developer overhead                                              | `patched()` gates around every change in patch mode      | Bump a version string                                 |
| Toolchain dependency                                            | AST walker, build-time plugin, ESLint rule for `patched` | One ESLint rule + optional lock file                  |
| Mental model                                                    | "Hash my source code, refuse if it differs"              | "Old code resumes old runs; new code starts new runs" |
| Multi-version cost                                              | Memory: one workflow definition                          | Memory: N workflow definitions (one per live version) |
| Drain semantics                                                 | Manual via `selectWorkflowVersion`                       | Automatic — registry routes by run's pinned version   |
| Failure mode when developer forgets                             | Patch mode: silent corruption                            | Lint rule errors at commit time                       |

The trade-off is **explicitness over magic**. The developer is in charge of declaring when behavior has changed. In exchange, every spurious-refusal failure mode goes away, and the operational story becomes trivial: "ship code, drain old versions, remove when empty."

## The mechanical model

### Definition

```typescript
defineWorkflow({
  name: 'onboard',
  version: 'v3',                          // required, unique per name
  previousVersions: [                     // optional; for in-flight runs
    { version: 'v1', run: bodyV1 },
    { version: 'v2', run: bodyV2 },
  ],
  input: ...,
  output: ...,
  state: ...,
  agents: ...,
  run: async function* () { ... },        // the v3 body
})
```

### Engine registration

```typescript
const engine = createEngine({
  workflows: [onboard, sendEmails, ...],
  storage: postgresStorage({ ... }),
  runtime: workerRuntime(),
})
```

The engine builds a `(name, version) → handler` lookup table from each workflow's `version` + every entry in its `previousVersions`. Internally:

```typescript
const registry = {
  'onboard:v1': onboard.previousVersions[0].run,
  'onboard:v2': onboard.previousVersions[1].run,
  'onboard:v3': onboard.run,
  'sendEmails:v1': sendEmails.run,
  // ...
}
```

### Run start

When a new run begins:

1. Look up the workflow by name → get current version (`'v3'`)
2. Persist `{ workflowName: 'onboard', version: 'v3' }` to the run record
3. Drive `onboard.run` (the v3 body)

### Run resume

When resuming a run (process restart, multi-instance routing, queued resume):

1. Load run record → get pinned `(name, version)` = `('onboard', 'v2')`
2. Look up handler in registry → `onboard.previousVersions[1].run`
3. Drive that exact body, replaying log entries by position
4. If lookup fails (version not in registry) → orphan inspector (escape hatches: abandon, restart, manual advance)

### Drain

Storage exposes a count query:

```typescript
const live = await storage.countRuns({
  workflowName: 'onboard',
  groupBy: 'version',
  status: 'active',
})
// { v1: 0, v2: 14, v3: 234 }
```

Devtools renders:

> **onboard**
>
> - v1: 0 active runs · safe to remove
> - v2: 14 active runs · expected drain in 6h
> - v3: 234 active runs · current

When `v1` drains to zero, the developer removes its entry from `previousVersions` on next deploy. Tree-shaking drops the dead code from the bundle. Operationally: trivial.

## How the developer bumps a version

Manual:

```typescript
// Before
export const onboard = defineWorkflow({
  name: 'onboard',
  version: 'v2',
  previousVersions: [{ version: 'v1', run: onboardV1Body }],
  run: async function* ({ input, agents }) {
    // v2 behavior
  },
})

// After making a behavior change
export const onboard = defineWorkflow({
  name: 'onboard',
  version: 'v3',
  previousVersions: [
    { version: 'v1', run: onboardV1Body },
    { version: 'v2', run: onboardV2Body }, // moved
  ],
  run: async function* ({ input, agents }) {
    // v3 behavior (the new code)
  },
})
```

CLI codemod:

```bash
npx @tanstack/workflow bump onboard
```

This command:

1. Reads `workflows/onboard.ts`
2. Captures the current `run` body
3. Appends `{ version: '<old>', run: <body> }` to `previousVersions`
4. Increments the version string (or prompts for a custom one)
5. Leaves the new `run` as a TODO comment for the developer
6. Updates `.tanstack/workflows.lock` (see below)

Now the developer writes the new body. Old behavior is preserved verbatim.

## The lock file — sanity check without runtime cost

A sidecar file in the repo, committed to git:

```json
// .tanstack/workflows.lock
{
  "onboard": {
    "v1": { "hash": "sha256:abc...", "lockedAt": "2026-04-01" },
    "v2": { "hash": "sha256:def...", "lockedAt": "2026-04-15" },
    "v3": { "hash": "sha256:ghi...", "lockedAt": "2026-05-20" }
  }
}
```

Generated and updated by `npx @tanstack/workflow lock` after a version bump or any intentional change. The hash is computed over the AST of the run function body (not the source text, so formatting / comments are ignored).

**ESLint rule `lockfile-integrity`:**

At lint time:

1. Recompute the AST hash of every version's `run` body
2. Compare to the locked hash
3. Mismatch → error: `Workflow 'onboard' version 'v2' has been modified since being locked. If this is intentional, run 'npx @tanstack/workflow bump onboard'. If this is accidental, revert your changes.`

**ESLint rule `current-version-bumped`:**

At lint time, on the _current_ version (`onboard.run`):

1. Recompute its AST hash
2. Compare to the locked hash
3. Mismatch → error: `Workflow 'onboard' current body changed without bumping the version. Run 'npx @tanstack/workflow bump onboard' if this is a behavior change, or 'npx @tanstack/workflow lock' if this is just a refactor of unchanged behavior.`

The developer is forced to make an explicit call: "is this a behavior change or not?" If yes, bump. If not, just re-lock.

This puts the fingerprint at **lint time**, not **runtime**. Same correctness guarantees, none of the runtime false-positive cost. The lock file is human-readable and git-diffable.

## What `patched()` was for, and why it's gone

In the old design, `patched()` existed because keeping multiple workflow source bodies alive simultaneously was expensive — the source-text fingerprint made it operationally heavy to ship `selectWorkflowVersion`-based deploys. So instead of "two versions side by side," you wrote "one version with an if-gate."

With explicit versioning:

- Multiple versions side by side is the _default_, not the exception
- The whole if-gate ceremony goes away
- Each version is just a function in `previousVersions`
- Tree-shaking keeps the cost reasonable (dead versions drop out as they're removed from the array)

`patched()` becomes a footnote. Maybe still useful for inline migrations _within_ a single version (e.g., "in v3, the third execution of this step uses a new branch"), but rarely needed.

## What changes in the engine

Minimal:

1. **Registry interface.** Add `previousVersions` to `defineWorkflow`. The engine builds the `(name, version) → handler` lookup at construction.
2. **Pin version at start.** Already in Alem's design (the version goes into the run record).
3. **Resume by version lookup.** Replace fingerprint-comparison with version-lookup. If the run's pinned version isn't in the registry → orphan inspector instead of `RUN_ERROR`.
4. **Drop the fingerprint module.** ~250 LoC gone. The FNV-1a code is gone. The `Function.prototype.toString()` calls are gone. Whitespace sensitivity is gone.
5. **Drop the `patches: [...]` field and `patched()` primitive.** Or keep them as a deprecated escape hatch for users migrating from Alem's existing branch.

What stays:

- Generators + `yield*` (the whole engine model)
- CAS conflict handling
- Idempotency keys
- All the primitives (`step`, `sleep`, `waitForSignal`, `approve`, `now`, `uuid`, `retry`)
- Replay engine itself
- Cross-version registry (now the default, not optional)

## What changes in the developer experience

What goes away:

- `patches: ['name-1', 'name-2']` ceremony on definitions
- `if (yield* patched('name-1')) { new } else { old }` in run bodies
- Worrying that `console.log` will kill runs
- Worrying that Prettier reformat will kill runs
- Worrying about minifier behavior across builds

What's new:

- Version string is required (one extra field per workflow)
- `previousVersions` accumulates as runs persist longer than a deploy cycle
- `.tanstack/workflows.lock` is committed to the repo
- ESLint rules `lockfile-integrity` + `current-version-bumped`
- `npx @tanstack/workflow bump <name>` codemod
- `npx @tanstack/workflow lock` for intentional non-behavioral edits

Net: the developer thinks about versioning when they're making a real change, and never has to think about it otherwise. Compare to fingerprinting where they have to think about deploy timing for every change to _any_ workflow source.

## Operational tier story under this design

Reframing the tiers from `SRC_SKEW_AND_RESUMPTION.md`:

### Tier 1: Workflows <1 hour

> Ship code freely. Most of the time you won't bump versions; even if you change the body, in-flight runs at deploy time complete in minutes. If anyone is mid-flight when you deploy, they continue on their pinned (previous) version. No drama.

### Tier 2: Workflows 1–24 hours

> Same as Tier 1, but expect 1–2 days of in-flight runs on the old version after a meaningful change. Bump the version when you change behavior; lint will tell you when to.

### Tier 3: Workflows 1–7 days

> Same model. `previousVersions` accumulates a few entries over a quarter. Devtools shows you when each version drains. Remove them on a subsequent deploy.

### Tier 4: Workflows 7–30 days

> Same model. You may end up with 5–10 historical versions in `previousVersions` over a year. Tree-shaking + lazy-loading per version keeps the bundle reasonable. Devtools surfaces drain timelines.

### Tier 5: Workflows >30 days

> Same model — and this is the big win. Long-running workflows that you couldn't reliably ship under fingerprinting now Just Work. The cost is bundle size for accumulated historical versions; the benefit is that 90-day workflows complete on the exact code they started on, even after months of deploys.

The operational story collapses to one rule across all tiers: **bump the version when behavior changes; the rest is automatic.**

## Risks and edge cases

### 1. Developer forgets to bump

Lint rule `current-version-bumped` catches this at commit time. If lint isn't running, the developer can ship a body change without a version bump, and in-flight runs corrupt silently.

**Mitigation:** ship the lint rule as part of `@tanstack/eslint-plugin-workflow`. Make `lockfile-integrity` and `current-version-bumped` part of the recommended preset. Add a CI check (`npx @tanstack/workflow check`) that verifies the lock file matches the workflows on disk.

### 2. Developer manually edits `previousVersions[].run`

Same risk. Same mitigation. Lint catches it via `lockfile-integrity`.

### 3. Lock file goes stale or gets deleted

The CI check should fail loudly if `.tanstack/workflows.lock` doesn't exist or has missing entries for declared versions. Treat it like `pnpm-lock.yaml` — required, committed, enforced.

### 4. Bundle bloat from accumulated `previousVersions`

For very long-running workflows (>30 days) with frequent versioning, you could accumulate many historical bodies. Mitigation:

- Tree-shake each version (already happens — they're function expressions, untouched by your active path)
- Lazy-load via dynamic import: `previousVersions: [{ version: 'v1', loader: () => import('./onboard-v1') }]`
- Devtools surfaces "v1 has 0 runs; remove on next deploy" actionable warning

The cost should be small in practice. Most workflows accumulate 2–4 historical versions; rarely more than 10.

### 5. Workflow name collisions

Same as today — the engine enforces name uniqueness at registration time. With versioning, the constraint becomes `(name, version)` unique. Two `defineWorkflow({ name: 'onboard', version: 'v3' })` calls in the same engine throw at startup.

### 6. Two developers concurrently bump to the same version string

Git merge conflict — surfaces the problem at PR time. Resolve by picking one (and renaming the other). The lock file diff makes the conflict visible.

### 7. Version strings as opaque identifiers

`v1`, `v2`, `v3` is the easiest scheme. But `version: '2026-05-20-feat-tenant-isolation'` is equally valid. Or git SHA. Or any uniqueness-respecting string. The engine doesn't care — it's just a map key.

Recommendation: the codemod defaults to monotonically incremented integers (`v1`, `v2`, ...) but allows custom strings via `--version 2026-05-20`.

### 8. What if the engine needs to know "which versions are active right now" for drain decisions?

Storage already groups by `(workflowName, version)`. The devtools query is:

```sql
SELECT workflow_name, version, COUNT(*)
FROM workflow_runs
WHERE status IN ('running', 'paused')
GROUP BY workflow_name, version
```

Cheap. Indexed. No engine support needed beyond the existing run table.

### 9. What about workflows that genuinely need to migrate state mid-flight?

E.g., "we added a required field to state; old runs don't have it." This is a real problem fingerprinting doesn't solve either — strict mode kills the run, patch mode lets you write a migration in user code.

With explicit versioning: the old version's run code continues to work on its old state shape. If you need to upgrade an old run to a new state shape mid-flight, that's a deliberate operation — provide a `migrateRun(runId, newVersion, transform)` API that's used explicitly by an operator.

## Honest costs of this design

1. **Boilerplate increase.** Every workflow gets a `version` field. Trivial.
2. **`previousVersions` array grows over time.** Acceptable in practice; lazy-loading helps for extreme cases.
3. **Lock file maintenance.** One CI failure if the developer forgets to run `lock`. Equivalent to `pnpm-lock.yaml` discipline.
4. **No automatic detection of "compatible" changes.** A whitespace-only change to a current version still requires `npx workflow lock` to update the hash. Not a real cost — lock is a one-command operation.
5. **Mental shift from "ship and pray" to "ship and version."** Initial onboarding cost; long-term clarity gain.

## Why this is the right call

The fingerprint approach is trying to _guess_ what the developer meant. AST fingerprinting is just a more sophisticated guess. Both can be wrong — too strict (kill spurious) or too loose (silent corruption).

Explicit versioning **stops guessing**. The developer tells the engine when behavior changed. The engine routes runs to the right code. The toolchain prevents the developer from making mistakes.

This is the same shift TypeScript itself made: "stop guessing types, declare them." The cost is more typing; the gain is that the system stops being wrong.

For a durable execution library where the failure mode of being wrong is "silently corrupt a 30-day workflow," "stop guessing" is overwhelmingly the right call.

## Conversation update for Alem

Add to the questions:

1. **Open to dropping the source-text fingerprint entirely and replacing it with explicit versioning + a lock file?** The runtime-correctness story is simpler, the false-positive surface goes away, and `patched()` becomes redundant. The cost is a `version: 'v1'` field on every workflow and a `.tanstack/workflows.lock` committed to the repo.
2. **Comfortable with `previousVersions: [...]` as the primary multi-version mechanism?** It makes the cross-version registry the default rather than an opt-in feature.
3. **Would you keep `patched()` as a deprecated escape hatch, or drop it cleanly?** If anyone's already using it on the branch, deprecation; otherwise just remove.
4. **Lint + codemod tooling.** Is `@tanstack/eslint-plugin-workflow` something the workflow repo owns, or shared with the AI repo?

## Updated bottom line

The skew + resumption story under explicit versioning is simpler than under fingerprinting. The library ships with:

1. `defineWorkflow({ name, version, previousVersions, run, ... })` as the definition
2. Engine that routes runs to their pinned version
3. `npx @tanstack/workflow bump <name>` codemod
4. `.tanstack/workflows.lock` + `npx @tanstack/workflow lock` to maintain it
5. `@tanstack/eslint-plugin-workflow` with `lockfile-integrity` + `current-version-bumped` rules
6. Devtools showing per-version run counts + drain status
7. Orphan inspector for the rare run whose version isn't in the registry

No fingerprint module. No AST walker at runtime. No build-time plugin matrix for fingerprinting (the lint rule's hash computation runs in the lint process, not in user code). No `patched()` ceremony. No whitespace sensitivity. No spurious refusals.

This is a strictly better foundation than fingerprinting. Worth the engine refactor. Worth telling Alem.
