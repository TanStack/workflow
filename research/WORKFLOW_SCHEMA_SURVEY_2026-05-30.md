# Workflow Schema Survey: Durable Primitives and Future-Proofing

Date: 2026-05-30

This survey compares workflow schema choices across CI/CD systems, state-machine
engines, DAG orchestrators, BPMN engines, and code-first durable execution
systems. The goal is not feature parity. The goal is to keep TanStack Workflow's
core primitives broad enough that common future capabilities can be added
without replacing persisted schemas or replay semantics.

## Systems Surveyed

| System               | Schema style                            | Relevant schema choices                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions       | YAML workflow with jobs and steps       | Named jobs and steps, `needs` dependencies, matrix fan-out, conditions, env/secrets/permissions, concurrency groups. Source: [workflow syntax](https://docs.github.com/actions/using-workflows/workflow-syntax-for-github-actions).                                                                                                                                       |
| GitLab CI            | YAML pipeline with stages/jobs          | Jobs are named top-level keys; stages are coarse ordering, `needs` is DAG ordering, `parallel:matrix`, rules, artifacts, resource groups for concurrency. Source: [CI/CD YAML reference](https://docs.gitlab.com/ci/yaml/).                                                                                                                                               |
| AWS Step Functions   | JSON state machine                      | Named states under `States`, `StartAt`, state types for Task, Choice, Wait, Map, Parallel, Succeed, Fail, plus Retry/Catch and input/output transforms. Sources: [state machines](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-statemachines.html), [error handling](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html). |
| Argo Workflows       | Kubernetes CRD YAML                     | Workflow spec with entrypoint, templates, `steps` or `dag`, parameters/artifacts, retries, suspend, synchronization, outputs. Sources: [DAG walkthrough](https://argo-workflows.readthedocs.io/en/latest/walk-through/dag/), [fields](https://argo-workflows.readthedocs.io/en/latest/fields/).                                                                           |
| Tekton Pipelines     | Kubernetes CRD YAML                     | PipelineTasks have names, params, results, workspaces, `runAfter`, `when`, retries, timeouts, matrix fan-out, finally tasks. Source: [Pipelines](https://tekton.dev/vault/pipelines-v1.3.x-lts/pipelines/).                                                                                                                                                               |
| Temporal             | Code-first durable workflows            | Deterministic workflow code, event history, activities, timers, signals, queries/updates, child workflows, continue-as-new, retry policies, task queues, versioning/build IDs. Sources: [Temporal docs](https://docs.temporal.io/), [protocol docs](https://api-docs.temporal.io/).                                                                                       |
| Inngest              | Code-first durable functions            | Functions have IDs, triggers, flow control, named `step.run`, sleeps, waits, retries, cancellation, versioning. Source: [Inngest functions](https://www.inngest.com/docs/learn/inngest-functions), [cancellation](https://www.inngest.com/docs/features/inngest-functions/cancellation).                                                                                  |
| Cloudflare Workflows | Code-first durable workflows            | Named `step.do`, `step.sleep`, retries and per-attempt timeouts; instances can run for long periods and persist state. Source: [sleeping and retrying](https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/).                                                                                                                                         |
| Trigger.dev          | Code-first tasks                        | Task IDs, retries, queues, nested task triggering, wait features, idempotency keys with run/attempt/global scoping. Sources: [tasks](https://trigger.dev/docs/tasks/overview), [idempotency](https://trigger.dev/docs/idempotency).                                                                                                                                       |
| Prefect              | Python flows/tasks plus deployments     | Flows/tasks with retries/timeouts, submitted/map concurrency, deployments with schedules, event triggers, work pools, versioned deployment config. Sources: [tasks](https://docs-3.prefect.io/v3/concepts/tasks), [deployments](https://docs.prefect.io/latest/concepts/deployments/).                                                                                    |
| Airflow              | Python DAG                              | DAGs define task dependencies; tasks/operators/sensors carry retries and scheduling; XCom handles cross-task data; dynamic task mapping expands task instances. Source: [architecture overview](https://airflow.staged.apache.org/docs/apache-airflow/2.6.0/core-concepts/overview.html).                                                                                 |
| Dagster              | Python assets/jobs/ops                  | Jobs/ops/assets, resources, config schemas, schedules/sensors, partitions, metadata, retries. Source: [Dagster docs](https://docs.dagster.io/).                                                                                                                                                                                                                           |
| Flyte                | Python tasks/workflows on typed backend | Typed tasks/workflows, launch plans, caching/memoization, retries, resources, dynamic workflows. Source: [tasks](https://docs-legacy.flyte.org/en/latest/user_guide/concepts/main_concepts/tasks.html).                                                                                                                                                                   |
| Conductor            | JSON workflow definition                | Versioned workflow definitions, task array, input/output parameters, timeout policies, task definitions, forks/joins, sub-workflows, events. Source: [workflow definition](https://docs.conductor-oss.org/documentation/configuration/workflowdef/index.html).                                                                                                            |
| BPMN/Camunda         | BPMN XML and visual model               | Activities, gateways, message/timer/signal/error/escalation/compensation events, subprocesses, event subprocesses, interrupting and non-interrupting behavior. Sources: [BPMN events](https://docs.camunda.io/docs/8.7/components/modeler/bpmn/events/), [event subprocess](https://docs.camunda.io/docs/components/modeler/bpmn/event-subprocesses/).                    |

## Universal Primitives

These show up broadly enough that our schema should be able to express them
without replacing persisted records later.

1. Stable durable operation IDs

   Declarative systems name states, jobs, tasks, templates, or activities.
   Code-first replay systems still name durable steps (`step.run`, `step.do`,
   activities, timers, signals). Positional matching is convenient for demos but
   fragile for long-lived runs.

   Decision: every durable primitive should have a stable `stepId`. `ctx.step`
   already had one. `sleep`, `sleepUntil`, `waitForEvent`, `approve`, `now`,
   and `uuid` now accept optional `id`.

2. Append-only history and current routing state

   Temporal, Step Functions, Conductor, BPMN engines, and this repo all separate
   durable history from current execution/routing state. History is the audit and
   replay source. Snapshot state is an index for queues, timers, waits, leases,
   and UI.

   Decision: keep the event log as truth. Keep run state as a routing projection.

3. Retry and timeout policy

   Nearly every system has retry and timeout semantics at the work-unit level.
   Some systems also have workflow-level timeout. Our `ctx.step` has retry and
   timeout. Workflow/run-level timeout can be added later as optional config and
   terminal events without replacing the log.

4. Timers and external events

   Wait/Timer/Signal/Message/Event appears across Step Functions, Temporal,
   BPMN, Inngest, Cloudflare, Conductor, and CI approvals. Our timer is modeled
   as an internal signal (`__timer`), which keeps one resume path.

   Decision: keep signals as the generalized wait primitive, and approvals as a
   first-class ergonomic specialization.

5. Fan-out/fan-in, parallel, map, matrix, and race

   DAG systems and CI systems represent parallel branches directly. Code-first
   systems can represent them through promises/child workflows but still need
   multiple outstanding awaitables in storage.

   Decision: add `RunState.awaiting[]` now. The current engine still creates one
   awaitable at a time, but the persisted shape can hold multiple waitpoints for
   future `all`, `race`, child workflow, or parallel branch primitives. The
   existing `waitingFor` and `pendingApproval` fields remain as compatibility
   projections.

6. Triggers and schedules

   CI systems put triggers in workflow YAML; Prefect/Inngest/Trigger.dev model
   triggers/deployments outside or beside function code; Temporal separates
   workflow code from schedules and clients. This diverges because deployment
   ownership differs.

   Decision: do not force triggers into `WorkflowDefinition` yet. Runtime
   registrations and schedules are the correct layer for now. Event/webhook
   triggers can be added as optional registration fields later.

7. Versioning

   Long-lived workflows need code-evolution strategy. Systems split between
   explicit definition versions (Conductor), build IDs/patching (Temporal), and
   deployment versioning (Prefect/Inngest). Our `version` plus
   `previousVersions` is a reasonable baseline.

   Decision: keep explicit workflow version routing. Future build-ID or migration
   helpers can be additive metadata on runs/registrations.

8. Metadata, labels, and observability

   Every system needs UI/audit data that should not affect replay. Some call it
   metadata, tags, labels, annotations, or context.

   Decision: durable operation events now carry optional `meta`. Broader
   workflow/run labels can be added later without changing primitive semantics.

## Divergent Choices and Why We Should Not Bake Them In Yet

- Declarative DAG DSL vs code-first replay: declarative schemas make graph
  inspection and visual editing easy. Code-first makes TypeScript ergonomics and
  app-local control better. TanStack Workflow should stay code-first, but the log
  schema should keep graph-friendly IDs and awaitables.

- JSONPath/data-transform schema vs typed values: Step Functions centers JSON
  path transforms; TypeScript systems lean on language types and schemas. We
  should not add JSONPath as a core primitive. Standard Schema input/output/wait
  validation is enough for now.

- Human tasks as first-class vs signal specialization: BPMN and business-process
  engines model human tasks richly. Code-first systems often model them as waits
  with UI metadata. Our `approve` primitive is worth keeping because AI and
  product workflows need it often, but assignment/ACL/reminders/escalations can
  be optional metadata or higher-level packages.

- Permissions/resources/secrets: CI and Kubernetes-native systems expose these
  in workflow YAML because they own execution infrastructure. TanStack Workflow
  is headless and app-embedded, so these should remain middleware/runtime/host
  concerns until there is a concrete adapter-level contract.

- Compensation/saga/finally: BPMN has compensation, Step Functions has Catch,
  CI has finally/always steps, and code-first systems often use try/finally.
  A first-class compensation API can be additive later; it should not force a
  DAG schema today.

## Changes Made From This Survey

- Added `DurableOperationOptions` with `id` and `meta`.
- Extended `ctx.sleep`, `ctx.sleepUntil`, `ctx.waitForEvent`, `ctx.approve`,
  `ctx.now`, and `ctx.uuid` to accept stable operation IDs.
- Changed replay matching for those primitives from positional-only to
  `stepId`-based matching.
- Added `stepId` and `meta` to signal/approval delivery events and paused run
  projections.
- Added `RunState.awaiting[]` and propagated it through runtime and Postgres
  store schemas while keeping `waitingFor` and `pendingApproval` for current
  callers.

## Remaining Future-Proof Additions To Consider

- Optional run/workflow `labels`, `metadata`, `correlationId`, `parentRunId`,
  and `rootRunId` for search, tenancy, lineage, and child workflows.
- A child workflow primitive that records parent/child lifecycle events and uses
  run lineage fields.
- A first-class `race`/`all` primitive that can populate multiple `awaiting[]`
  entries and resolve one or many.
- Workflow-level timeout/cancel policies and run-level cancellation reasons.
- Optional queue/concurrency policy at runtime registration level, distinct from
  schedule overlap policy.
- Retention/archival metadata for event logs, including continue-as-new style
  history compaction.

The important thing is that none of these require replacing today's core
records after the changes above. They can be added as optional fields, new event
types, or higher-level primitives that compile down to the same event log plus
run-state projection model.
