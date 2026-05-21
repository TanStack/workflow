import type { AnyWorkflowDefinition, RunStore } from '../types'

/**
 * Pick the workflow version that a persisted run was started under.
 *
 * Hosts running multiple versions of the same workflow side-by-side
 * use this to route resume calls to the right code path. Each
 * `WorkflowDefinition` should carry a `version` field
 * (`createWorkflow({ version: 'v1', ... })`); the helper compares
 * that against the `workflowVersion` field on the run's persisted
 * state.
 *
 * Resolution order:
 *   1. Exact match by `workflowId` AND `workflowVersion`.
 *   2. If no `workflowVersion` is persisted (e.g., older runs from
 *      before the version field existed), fall back to the FIRST
 *      definition whose `id` matches and which does NOT declare
 *      `version` (the "unversioned default").
 *   3. Otherwise undefined — the host decides whether to reject or
 *      use a latest-version fallback.
 *
 *     const v1 = createWorkflow({ id: 'pipeline', version: 'v1' }).handler(...)
 *     const v2 = createWorkflow({ id: 'pipeline', version: 'v2' }).handler(...)
 *     const wf = await selectWorkflowVersion([v1, v2], runId, store)
 *                  ?? v2 // default to latest for fresh starts / unrouted runs
 *     runWorkflow({ workflow: wf, runId, ... })
 */
export async function selectWorkflowVersion<T extends AnyWorkflowDefinition>(
  versions: ReadonlyArray<T>,
  runId: string,
  runStore: RunStore,
): Promise<T | undefined> {
  const runState = await runStore.getRunState(runId)
  if (!runState) return undefined

  if (runState.workflowVersion) {
    // The run was started under a specific version. Return the exact
    // match if registered, otherwise `undefined` — falling through to
    // the unversioned default for a versioned run would route a v1
    // run into v-undefined code, which is a determinism violation.
    return versions.find(
      (v) =>
        v.id === runState.workflowId &&
        v.version === runState.workflowVersion,
    )
  }

  // Legacy fallback: pre-versioning runs have no workflowVersion;
  // match by id + no version declared.
  return versions.find(
    (v) => v.id === runState.workflowId && v.version === undefined,
  )
}

/**
 * Lightweight registry around `selectWorkflowVersion`. Same
 * resolution rules; same routing semantics.
 *
 *     const registry = createWorkflowRegistry({ default: v2 })
 *     registry.add(v1)
 *     registry.add(v2)
 *     const wf = await registry.forRun(runId, store)
 *     runWorkflow({ workflow: wf, runId, ... })
 */
export interface WorkflowRegistry<T extends AnyWorkflowDefinition> {
  /** Register a workflow definition. Duplicate (id, version) pairs
   *  are rejected. */
  add: (workflow: T) => void
  /** Pick the workflow version for a persisted run. Returns the
   *  registry's `default` if no exact match is found. */
  forRun: (runId: string, runStore: RunStore) => Promise<T | undefined>
  /** Get a specific version by (id, version) pair. */
  get: (id: string, version?: string) => T | undefined
  /** All registered versions. */
  all: () => ReadonlyArray<T>
}

export function createWorkflowRegistry<T extends AnyWorkflowDefinition>(
  options: { default?: T } = {},
): WorkflowRegistry<T> {
  const entries: Array<T> = []

  return {
    add(workflow) {
      const dupe = entries.find(
        (e) => e.id === workflow.id && e.version === workflow.version,
      )
      if (dupe) {
        throw new Error(
          `Workflow "${workflow.id}" version "${workflow.version ?? '(none)'}" is already registered.`,
        )
      }
      entries.push(workflow)
    },
    async forRun(runId, runStore) {
      const matched = await selectWorkflowVersion(entries, runId, runStore)
      return matched ?? options.default
    },
    get(id, version) {
      return entries.find((e) => e.id === id && e.version === version)
    },
    all() {
      return entries
    },
  }
}
