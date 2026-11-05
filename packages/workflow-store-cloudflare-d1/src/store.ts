import { LogConflictError } from '@tanstack/workflow-core'
import {
  getCloudflareD1WorkflowStoreSchemaStatements,
  quoteIdent,
  resolveCloudflareD1WorkflowStoreTables,
} from './schema-contract'
import type { RunState, WorkflowEvent } from '@tanstack/workflow-core'
import type { CloudflareD1WorkflowStoreTables } from './schema-contract'
import type {
  AppendEventsArgs,
  AppendEventsResult,
  ClaimDueScheduleBucketsArgs,
  ClaimDueTimersArgs,
  ClaimRunArgs,
  ClaimRunResult,
  ClaimStaleRunsArgs,
  CreateRunArgs,
  CreateRunResult,
  DeliverApprovalArgs,
  DeliverApprovalResult,
  DeliverSignalArgs,
  DeliverSignalResult,
  HeartbeatRunLeaseArgs,
  ListRunsArgs,
  LoadedExecution,
  MarkRunErroredArgs,
  MarkRunFinishedArgs,
  MarkRunPausedArgs,
  MarkScheduleBucketStartedArgs,
  ReadEventsArgs,
  ReleaseRunLeaseArgs,
  RunClaim,
  RunId,
  RunSummary,
  RunTimeline,
  SaveRunStateArgs,
  ScheduleBucket,
  ScheduleBucketId,
  ScheduleId,
  ScheduleTimerArgs,
  StoredWorkflowEvent,
  TimerWakeup,
  UpsertScheduleArgs,
  WorkflowExecution,
  WorkflowExecutionStatus,
  WorkflowExecutionStore,
  WorkflowRunStoreAdapterStore,
} from '@tanstack/workflow-runtime'

type D1Value = string | number | boolean | null

export interface CloudflareD1Result<TRow = unknown> {
  success: true
  meta: Record<string, unknown>
  results: Array<TRow>
}

export interface CloudflareD1PreparedStatement {
  bind: (...values: Array<unknown>) => CloudflareD1PreparedStatement
  all: <TRow = Record<string, unknown>>() => Promise<CloudflareD1Result<TRow>>
  first: <TRow = Record<string, unknown>>(
    colName?: string,
  ) => Promise<TRow | null>
  raw: {
    <TRow = Array<unknown>>(options: {
      columnNames: true
    }): Promise<[Array<string>, ...Array<TRow>]>
    <TRow = Array<unknown>>(options?: {
      columnNames?: false
    }): Promise<Array<TRow>>
  }
  run: <TRow = Record<string, unknown>>() => Promise<CloudflareD1Result<TRow>>
}

export interface CloudflareD1Database {
  prepare: (query: string) => CloudflareD1PreparedStatement
  batch?: unknown
  exec?: (query: string) => Promise<unknown>
}

export interface CloudflareD1WorkflowStoreOptions {
  db: CloudflareD1Database
  tables?: Partial<CloudflareD1WorkflowStoreTables>
}

export type CloudflareD1WorkflowStore = WorkflowExecutionStore &
  WorkflowRunStoreAdapterStore & {
    ensureSchema: () => Promise<void>
  }

export function createCloudflareD1WorkflowStore(
  options: CloudflareD1WorkflowStoreOptions,
): CloudflareD1WorkflowStore {
  const tableNames = resolveCloudflareD1WorkflowStoreTables(options.tables)
  const tables = tableSqls(tableNames)
  const db = options.db

  return {
    async ensureSchema() {
      for (const statement of getCloudflareD1WorkflowStoreSchemaStatements({
        tables: tableNames,
      })) {
        await execute(db, statement)
      }
    },

    async createRun(args: CreateRunArgs): Promise<CreateRunResult> {
      const rows = await query<RunRow>(
        db,
        `
          insert into ${tables.runs} (
            run_id,
            workflow_id,
            workflow_version,
            status,
            input,
            created_at,
            updated_at
          )
          values (?, ?, ?, 'queued', ?, ?, ?)
          on conflict (run_id) do nothing
          returning *
        `,
        [
          args.runId,
          args.workflowId,
          args.workflowVersion ?? null,
          encodeJson(args.input),
          args.now,
          args.now,
        ],
      )
      if (rows[0]) return { kind: 'created', run: runFromRow(rows[0]) }

      const existing = await loadRunById(db, tables, args.runId)
      if (!existing) {
        throw new Error(`Run "${args.runId}" was not inserted or loaded.`)
      }
      return { kind: 'existing', run: existing }
    },

    loadRun(runId) {
      return loadRunById(db, tables, runId)
    },

    async loadExecution(runId): Promise<LoadedExecution | undefined> {
      const run = await loadRunById(db, tables, runId)
      if (!run) return undefined
      return {
        run,
        events: await readStoredEvents(db, tables, { runId }),
      }
    },

    loadRunState(runId) {
      return loadRunStateById(db, tables, runId)
    },

    async saveRunState(args: SaveRunStateArgs) {
      const state = args.state
      await executeMany(db, [
        statement(
          `
            insert into ${tables.runStates} (
              run_id,
              workflow_id,
              workflow_version,
              status,
              input,
              output,
              error,
              awaiting,
              waiting_for,
              pending_approval,
              created_at,
              updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict (run_id) do update set
              workflow_id = excluded.workflow_id,
              workflow_version = excluded.workflow_version,
              status = excluded.status,
              input = excluded.input,
              output = excluded.output,
              error = excluded.error,
              awaiting = excluded.awaiting,
              waiting_for = excluded.waiting_for,
              pending_approval = excluded.pending_approval,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `,
          [
            state.runId,
            state.workflowId,
            state.workflowVersion ?? null,
            state.status,
            encodeJson(state.input),
            encodeJsonOrNull(state.output),
            encodeJsonOrNull(state.error),
            encodeJsonOrNull(state.awaiting),
            encodeJsonOrNull(state.waitingFor),
            encodeJsonOrNull(state.pendingApproval),
            state.createdAt,
            state.updatedAt,
          ],
        ),
        statement(
          `
            insert into ${tables.runs} (
              run_id,
              workflow_id,
              workflow_version,
              status,
              input,
              output,
              error,
              awaiting,
              waiting_for,
              pending_approval,
              wake_at,
              created_at,
              updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict (run_id) do update set
              workflow_id = excluded.workflow_id,
              workflow_version = excluded.workflow_version,
              status = excluded.status,
              input = excluded.input,
              output = excluded.output,
              error = excluded.error,
              awaiting = excluded.awaiting,
              waiting_for = excluded.waiting_for,
              pending_approval = excluded.pending_approval,
              wake_at = excluded.wake_at,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at
          `,
          [
            state.runId,
            state.workflowId,
            state.workflowVersion ?? null,
            state.status,
            encodeJson(state.input),
            encodeJsonOrNull(state.output),
            encodeJsonOrNull(state.error),
            encodeJsonOrNull(state.awaiting),
            encodeJsonOrNull(state.waitingFor),
            encodeJsonOrNull(state.pendingApproval),
            state.waitingFor?.signalName === '__timer'
              ? (state.waitingFor.deadline ?? null)
              : null,
            state.createdAt,
            state.updatedAt,
          ],
        ),
      ])
    },

    async deleteRun(runId) {
      await executeMany(db, [
        statement(`delete from ${tables.runStates} where run_id = ?`, [runId]),
        statement(`delete from ${tables.eventLocks} where run_id = ?`, [runId]),
        statement(`delete from ${tables.signalDeliveries} where run_id = ?`, [
          runId,
        ]),
        statement(`delete from ${tables.timers} where run_id = ?`, [runId]),
        statement(`delete from ${tables.events} where run_id = ?`, [runId]),
        statement(`delete from ${tables.runs} where run_id = ?`, [runId]),
      ])
    },

    async appendEvents(args: AppendEventsArgs): Promise<AppendEventsResult> {
      await execute(
        db,
        `
          insert into ${tables.eventLocks} (run_id, created_at)
          values (?, ?)
          on conflict (run_id) do nothing
        `,
        [args.runId, Date.now()],
      )

      const countRows = await query<{ count: number | string }>(
        db,
        `
          select count(*) as count
          from ${tables.events}
          where run_id = ?
        `,
        [args.runId],
      )
      const currentCount = Number(countRows[0]?.count ?? 0)

      if (currentCount !== args.expectedNextIndex) {
        const conflict = await loadEventAtIndex(
          db,
          tables,
          args.runId,
          args.expectedNextIndex,
        )
        throw new LogConflictError(
          args.runId,
          args.expectedNextIndex,
          conflict?.event,
        )
      }

      let nextIndex = args.expectedNextIndex
      for (const event of args.events) {
        try {
          await execute(
            db,
            `
              insert into ${tables.events} (
                run_id,
                event_index,
                event_type,
                step_id,
                event,
                created_at
              )
              values (?, ?, ?, ?, ?, ?)
            `,
            [
              args.runId,
              nextIndex,
              event.type,
              getStepId(event) ?? null,
              encodeJson(event),
              event.ts,
            ],
          )
        } catch {
          const conflict = await loadEventAtIndex(
            db,
            tables,
            args.runId,
            nextIndex,
          )
          throw new LogConflictError(args.runId, nextIndex, conflict?.event)
        }
        nextIndex++
      }

      return { nextIndex }
    },

    readEvents(args) {
      return readStoredEvents(db, tables, args)
    },

    async claimRun(args: ClaimRunArgs): Promise<ClaimRunResult> {
      const rows = await query<RunRow>(
        db,
        `
          update ${tables.runs}
          set
            status = 'running',
            lease_owner = ?,
            lease_expires_at = ?,
            updated_at = ?
          where run_id = ?
            and status not in ('finished', 'errored', 'aborted')
            and (
              lease_owner is null
              or lease_owner = ?
              or lease_expires_at <= ?
            )
          returning *
        `,
        [
          args.leaseOwner,
          args.now + args.leaseMs,
          args.now,
          args.runId,
          args.leaseOwner,
          args.now,
        ],
      )
      if (rows[0]) return { kind: 'claimed', run: runFromRow(rows[0]) }

      const run = await loadRunById(db, tables, args.runId)
      return run ? { kind: 'not-claimable', run } : { kind: 'not-found' }
    },

    async heartbeatRunLease(args: HeartbeatRunLeaseArgs) {
      await execute(
        db,
        `
          update ${tables.runs}
          set
            lease_expires_at = ?,
            updated_at = ?
          where run_id = ?
            and lease_owner = ?
        `,
        [args.now + args.leaseMs, args.now, args.runId, args.leaseOwner],
      )
    },

    async releaseRunLease(args: ReleaseRunLeaseArgs) {
      await execute(
        db,
        `
          update ${tables.runs}
          set
            lease_owner = null,
            lease_expires_at = null
          where run_id = ?
            and lease_owner = ?
        `,
        [args.runId, args.leaseOwner],
      )
    },

    async markRunPaused(args: MarkRunPausedArgs) {
      await execute(
        db,
        `
          update ${tables.runs}
          set
            status = 'paused',
            awaiting = ?,
            waiting_for = ?,
            pending_approval = ?,
            wake_at = ?,
            lease_owner = null,
            lease_expires_at = null,
            updated_at = ?
          where run_id = ?
        `,
        [
          encodeJsonOrNull(args.awaiting),
          encodeJsonOrNull(args.waitingFor),
          encodeJsonOrNull(args.pendingApproval),
          args.wakeAt ?? null,
          args.now,
          args.runId,
        ],
      )
    },

    async markRunFinished(args: MarkRunFinishedArgs) {
      await execute(
        db,
        `
          update ${tables.runs}
          set
            status = 'finished',
            output = ?,
            awaiting = null,
            waiting_for = null,
            pending_approval = null,
            wake_at = null,
            lease_owner = null,
            lease_expires_at = null,
            updated_at = ?
          where run_id = ?
        `,
        [encodeJson(args.output), args.now, args.runId],
      )
    },

    async markRunErrored(args: MarkRunErroredArgs) {
      void args.code
      await execute(
        db,
        `
          update ${tables.runs}
          set
            status = 'errored',
            error = ?,
            awaiting = null,
            waiting_for = null,
            pending_approval = null,
            wake_at = null,
            lease_owner = null,
            lease_expires_at = null,
            updated_at = ?
          where run_id = ?
        `,
        [encodeJson(args.error), args.now, args.runId],
      )
    },

    async scheduleTimer(args: ScheduleTimerArgs) {
      await executeMany(db, [
        statement(
          `
            insert into ${tables.timers} (
              run_id,
              signal_id,
              workflow_id,
              workflow_version,
              wake_at
            )
            values (?, ?, ?, ?, ?)
            on conflict (run_id, signal_id) do update set
              workflow_id = excluded.workflow_id,
              workflow_version = excluded.workflow_version,
              wake_at = excluded.wake_at,
              lease_owner = null,
              lease_expires_at = null
          `,
          [
            args.runId,
            args.signalId,
            args.workflowId,
            args.workflowVersion ?? null,
            args.wakeAt,
          ],
        ),
        statement(
          `
            update ${tables.runs}
            set
              wake_at = ?,
              updated_at = ?
            where run_id = ?
          `,
          [args.wakeAt, args.now, args.runId],
        ),
      ])
    },

    async claimDueTimers(args: ClaimDueTimersArgs) {
      const due = await query<{ run_id: string; signal_id: string }>(
        db,
        `
          select run_id, signal_id
          from ${tables.timers}
          where wake_at <= ?
            and (
              lease_owner is null
              or lease_owner = ?
              or lease_expires_at <= ?
            )
          order by wake_at asc, run_id asc, signal_id asc
          limit ?
        `,
        [args.now, args.leaseOwner, args.now, args.limit],
      )
      const timers: Array<TimerWakeup> = []

      for (const timer of due) {
        const rows = await query<TimerRow>(
          db,
          `
            update ${tables.timers}
            set
              lease_owner = ?,
              lease_expires_at = ?
            where run_id = ?
              and signal_id = ?
              and (
                lease_owner is null
                or lease_owner = ?
                or lease_expires_at <= ?
              )
            returning *
          `,
          [
            args.leaseOwner,
            args.now + args.leaseMs,
            timer.run_id,
            timer.signal_id,
            args.leaseOwner,
            args.now,
          ],
        )
        if (rows[0]) timers.push(timerFromRow(rows[0]))
      }

      return timers
    },

    async deliverSignal<TPayload>(
      args: DeliverSignalArgs<TPayload>,
    ): Promise<DeliverSignalResult> {
      const run = await loadRunById(db, tables, args.runId)
      if (!run) return { kind: 'not-found' }

      const existingDelivery = await loadSignalDelivery(
        db,
        tables,
        args.runId,
        args.delivery.signalId,
      )
      if (existingDelivery) return { kind: 'duplicate', run }

      if (run.waitingFor?.signalName !== args.delivery.name) {
        return { kind: 'not-waiting', run }
      }

      const inserted = await insertSignalDelivery(
        db,
        tables,
        args.runId,
        args.delivery.signalId,
        args.now,
      )
      if (!inserted) return { kind: 'duplicate', run }

      await execute(
        db,
        `delete from ${tables.timers} where run_id = ? and signal_id = ?`,
        [args.runId, args.delivery.signalId],
      )

      const rows = await query<RunRow>(
        db,
        `
          update ${tables.runs}
          set
            status = 'queued',
            awaiting = null,
            waiting_for = null,
            pending_approval = null,
            wake_at = null,
            updated_at = ?
          where run_id = ?
          returning *
        `,
        [args.now, args.runId],
      )

      return { kind: 'delivered', run: runFromRow(rows[0]!) }
    },

    async deliverApproval(
      args: DeliverApprovalArgs,
    ): Promise<DeliverApprovalResult> {
      const run = await loadRunById(db, tables, args.runId)
      if (!run) return { kind: 'not-found' }

      const signalId = `approval:${args.approval.approvalId}`
      const existingDelivery = await loadSignalDelivery(
        db,
        tables,
        args.runId,
        signalId,
      )
      if (existingDelivery) return { kind: 'duplicate', run }

      if (run.pendingApproval?.approvalId !== args.approval.approvalId) {
        return { kind: 'not-waiting', run }
      }

      const inserted = await insertSignalDelivery(
        db,
        tables,
        args.runId,
        signalId,
        args.now,
      )
      if (!inserted) return { kind: 'duplicate', run }

      const rows = await query<RunRow>(
        db,
        `
          update ${tables.runs}
          set
            status = 'queued',
            awaiting = null,
            waiting_for = null,
            pending_approval = null,
            wake_at = null,
            updated_at = ?
          where run_id = ?
          returning *
        `,
        [args.now, args.runId],
      )

      return { kind: 'delivered', run: runFromRow(rows[0]!) }
    },

    async upsertSchedule(args: UpsertScheduleArgs) {
      await execute(
        db,
        `
          insert into ${tables.schedules} (
            schedule_id,
            workflow_id,
            workflow_version,
            schedule,
            overlap_policy,
            input,
            next_fire_at,
            enabled,
            updated_at
          )
          values (?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict (schedule_id) do update set
            workflow_id = excluded.workflow_id,
            workflow_version = excluded.workflow_version,
            schedule = excluded.schedule,
            overlap_policy = excluded.overlap_policy,
            input = excluded.input,
            next_fire_at = excluded.next_fire_at,
            enabled = excluded.enabled,
            updated_at = excluded.updated_at
        `,
        [
          args.scheduleId,
          args.workflowId,
          args.workflowVersion ?? null,
          encodeJson(args.schedule),
          args.overlapPolicy,
          encodeJsonOrNull(args.input),
          args.nextFireAt ?? null,
          args.enabled ? 1 : 0,
          args.now,
        ],
      )
    },

    async claimDueScheduleBuckets(args: ClaimDueScheduleBucketsArgs) {
      const schedules = await query<ScheduleRow>(
        db,
        `
          select schedule.*
          from ${tables.schedules} schedule
          left join ${tables.scheduleBuckets} bucket
            on bucket.schedule_id = schedule.schedule_id
            and bucket.bucket_id = cast(schedule.next_fire_at as text)
          where schedule.enabled = 1
            and schedule.next_fire_at is not null
            and schedule.next_fire_at <= ?
            and (
              bucket.schedule_id is null
              or (
                bucket.status <> 'started'
                and (
                  bucket.lease_owner is null
                  or bucket.lease_owner = ?
                  or bucket.lease_expires_at <= ?
                )
              )
            )
          order by schedule.next_fire_at asc, schedule.schedule_id asc
          limit ?
        `,
        [args.now, args.leaseOwner, args.now, args.limit],
      )
      const buckets: Array<ScheduleBucket> = []

      for (const scheduleRow of schedules) {
        if (buckets.length >= args.limit) break

        const schedule = scheduleFromRow(scheduleRow)
        const bucketId = `${schedule.nextFireAt}` satisfies ScheduleBucketId
        const runId = `${schedule.workflowId}:${schedule.scheduleId}:${bucketId}`

        await execute(
          db,
          `
            insert into ${tables.scheduleBuckets} (
              schedule_id,
              bucket_id,
              workflow_id,
              workflow_version,
              run_id,
              fire_at,
              input,
              overlap_policy,
              status
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, 'claimed')
            on conflict (schedule_id, bucket_id) do nothing
          `,
          [
            schedule.scheduleId,
            bucketId,
            schedule.workflowId,
            schedule.workflowVersion ?? null,
            runId,
            schedule.nextFireAt,
            encodeJsonOrNull(schedule.input),
            schedule.overlapPolicy,
          ],
        )

        const rows = await query<ScheduleBucketRow>(
          db,
          `
            update ${tables.scheduleBuckets}
            set
              lease_owner = ?,
              lease_expires_at = ?
            where schedule_id = ?
              and bucket_id = ?
              and status <> 'started'
              and (
                lease_owner is null
                or lease_owner = ?
                or lease_expires_at <= ?
              )
            returning *
          `,
          [
            args.leaseOwner,
            args.now + args.leaseMs,
            schedule.scheduleId,
            bucketId,
            args.leaseOwner,
            args.now,
          ],
        )
        if (rows[0]) buckets.push(scheduleBucketFromRow(rows[0]))
      }

      return buckets
    },

    async markScheduleBucketStarted(args: MarkScheduleBucketStartedArgs) {
      await execute(
        db,
        `
          update ${tables.scheduleBuckets}
          set
            run_id = ?,
            status = 'started',
            started_at = ?
          where schedule_id = ?
            and bucket_id = ?
        `,
        [args.runId, args.now, args.scheduleId, args.bucketId],
      )
    },

    async claimStaleRuns(args: ClaimStaleRunsArgs) {
      const stale = await query<{ run_id: string }>(
        db,
        `
          select run_id
          from ${tables.runs}
          where status = 'running'
            and lease_expires_at is not null
            and lease_expires_at <= ?
          order by updated_at asc, run_id asc
          limit ?
        `,
        [args.now, args.limit],
      )
      const claims: Array<RunClaim> = []

      for (const row of stale) {
        const rows = await query<RunRow>(
          db,
          `
            update ${tables.runs}
            set
              lease_owner = ?,
              lease_expires_at = ?,
              updated_at = ?
            where run_id = ?
              and status = 'running'
              and lease_expires_at is not null
              and lease_expires_at <= ?
            returning *
          `,
          [
            args.leaseOwner,
            args.now + args.leaseMs,
            args.now,
            row.run_id,
            args.now,
          ],
        )
        if (rows[0]) {
          const run = runFromRow(rows[0])
          claims.push({ run, lease: run.lease! })
        }
      }

      return claims
    },

    async listRuns(args: ListRunsArgs) {
      const offset = args.cursor ? Number(args.cursor) : 0
      const start = Number.isFinite(offset) && offset > 0 ? offset : 0
      const rows = await query<RunRow>(
        db,
        `
          select *
          from ${tables.runs}
          where (? is null or workflow_id = ?)
            and (? is null or status = ?)
          order by updated_at desc, run_id asc
          limit ?
          offset ?
        `,
        [
          args.workflowId ?? null,
          args.workflowId ?? null,
          args.status ?? null,
          args.status ?? null,
          args.limit,
          start,
        ],
      )

      return rows.map(toRunSummary)
    },

    async getRunTimeline(runId: RunId): Promise<RunTimeline | undefined> {
      const run = await loadRunById(db, tables, runId)
      if (!run) return undefined
      return {
        run,
        events: await readStoredEvents(db, tables, { runId }),
      }
    },
  }
}

interface TableSqls {
  runs: string
  runStates: string
  eventLocks: string
  events: string
  timers: string
  signalDeliveries: string
  schedules: string
  scheduleBuckets: string
}

interface RunRow {
  run_id: string
  workflow_id: string
  workflow_version: string | null
  status: WorkflowExecutionStatus
  input: unknown
  output: unknown
  error: unknown
  awaiting: unknown
  waiting_for: unknown
  pending_approval: unknown
  wake_at: number | string | null
  lease_owner: string | null
  lease_expires_at: number | string | null
  created_at: number | string
  updated_at: number | string
}

interface RunStateRow {
  run_id: string
  workflow_id: string
  workflow_version: string | null
  status: RunState['status']
  input: unknown
  output: unknown
  error: unknown
  awaiting: unknown
  waiting_for: unknown
  pending_approval: unknown
  created_at: number | string
  updated_at: number | string
}

interface EventRow {
  run_id: string
  event_index: number | string
  event_type: WorkflowEvent['type']
  step_id: string | null
  event: unknown
  created_at: number | string
}

interface TimerRow {
  run_id: string
  workflow_id: string
  workflow_version: string | null
  wake_at: number | string
  signal_id: string
}

interface ScheduleRow {
  schedule_id: string
  workflow_id: string
  workflow_version: string | null
  input: unknown
  overlap_policy: ScheduleBucket['overlapPolicy']
  next_fire_at: number | string
}

interface ScheduleBucketRow {
  schedule_id: string
  bucket_id: string
  workflow_id: string
  workflow_version: string | null
  run_id: string
  fire_at: number | string
  input: unknown
  overlap_policy: ScheduleBucket['overlapPolicy']
}

interface Statement {
  sql: string
  params: Array<D1Value>
}

function tableSqls(tables: CloudflareD1WorkflowStoreTables): TableSqls {
  return {
    runs: quoteIdent(tables.runs),
    runStates: quoteIdent(tables.runStates),
    eventLocks: quoteIdent(tables.eventLocks),
    events: quoteIdent(tables.events),
    timers: quoteIdent(tables.timers),
    signalDeliveries: quoteIdent(tables.signalDeliveries),
    schedules: quoteIdent(tables.schedules),
    scheduleBuckets: quoteIdent(tables.scheduleBuckets),
  }
}

function statement(sql: string, params: Array<D1Value> = []): Statement {
  return { sql, params }
}

async function execute(
  db: CloudflareD1Database,
  sql: string,
  params: Array<D1Value> = [],
) {
  await db
    .prepare(sql)
    .bind(...params)
    .run()
}

async function executeMany(
  db: CloudflareD1Database,
  statements: Array<Statement>,
) {
  if (hasBatch(db)) {
    await db.batch(
      statements.map(({ sql, params }) => db.prepare(sql).bind(...params)),
    )
    return
  }

  for (const item of statements) {
    await execute(db, item.sql, item.params)
  }
}

function hasBatch(db: CloudflareD1Database): db is CloudflareD1Database & {
  batch: (statements: Array<CloudflareD1PreparedStatement>) => Promise<unknown>
} {
  return typeof db.batch === 'function'
}

async function query<TRow>(
  db: CloudflareD1Database,
  sql: string,
  params: Array<D1Value> = [],
): Promise<Array<TRow>> {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<TRow>()
  return result.results
}

async function loadRunById(
  db: CloudflareD1Database,
  tables: TableSqls,
  runId: RunId,
) {
  const rows = await query<RunRow>(
    db,
    `select * from ${tables.runs} where run_id = ? limit 1`,
    [runId],
  )
  return rows[0] ? runFromRow(rows[0]) : undefined
}

async function loadRunStateById(
  db: CloudflareD1Database,
  tables: TableSqls,
  runId: RunId,
): Promise<RunState | undefined> {
  const rows = await query<RunStateRow>(
    db,
    `select * from ${tables.runStates} where run_id = ? limit 1`,
    [runId],
  )
  return rows[0] ? runStateFromRow(rows[0]) : undefined
}

async function readStoredEvents(
  db: CloudflareD1Database,
  tables: TableSqls,
  args: ReadEventsArgs,
): Promise<ReadonlyArray<StoredWorkflowEvent>> {
  const rows = await query<EventRow>(
    db,
    `
      select *
      from ${tables.events}
      where run_id = ?
        and event_index >= ?
      order by event_index asc
    `,
    [args.runId, args.fromIndex ?? 0],
  )
  return rows.map(eventFromRow)
}

async function loadEventAtIndex(
  db: CloudflareD1Database,
  tables: TableSqls,
  runId: RunId,
  eventIndex: number,
) {
  const rows = await query<EventRow>(
    db,
    `
      select *
      from ${tables.events}
      where run_id = ?
        and event_index = ?
      limit 1
    `,
    [runId, eventIndex],
  )
  return rows[0] ? eventFromRow(rows[0]) : undefined
}

async function loadSignalDelivery(
  db: CloudflareD1Database,
  tables: TableSqls,
  runId: RunId,
  signalId: string,
) {
  const rows = await query<{ run_id: string }>(
    db,
    `
      select run_id
      from ${tables.signalDeliveries}
      where run_id = ?
        and signal_id = ?
      limit 1
    `,
    [runId, signalId],
  )
  return Boolean(rows[0])
}

async function insertSignalDelivery(
  db: CloudflareD1Database,
  tables: TableSqls,
  runId: RunId,
  signalId: string,
  now: number,
) {
  const rows = await query<{ run_id: string }>(
    db,
    `
      insert into ${tables.signalDeliveries} (run_id, signal_id, created_at)
      values (?, ?, ?)
      on conflict (run_id, signal_id) do nothing
      returning run_id
    `,
    [runId, signalId, now],
  )
  return Boolean(rows[0])
}

function runFromRow(row: RunRow): WorkflowExecution {
  return {
    runId: row.run_id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version ?? undefined,
    status: row.status,
    input: decodeJson(row.input),
    output: decodeJsonOrUndefined(row.output),
    error: decodeJsonOrUndefined(row.error),
    awaiting: decodeJsonOrUndefined(row.awaiting),
    waitingFor: decodeJsonOrUndefined(row.waiting_for),
    pendingApproval: decodeJsonOrUndefined(row.pending_approval),
    wakeAt: numberOrUndefined(row.wake_at),
    lease:
      row.lease_owner && row.lease_expires_at !== null
        ? {
            owner: row.lease_owner,
            expiresAt: Number(row.lease_expires_at),
          }
        : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function runStateFromRow(row: RunStateRow): RunState {
  return {
    runId: row.run_id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version ?? undefined,
    status: row.status,
    input: decodeJson(row.input),
    output: decodeJsonOrUndefined(row.output),
    error: decodeJsonOrUndefined(row.error),
    awaiting: decodeJsonOrUndefined(row.awaiting),
    waitingFor: decodeJsonOrUndefined(row.waiting_for),
    pendingApproval: decodeJsonOrUndefined(row.pending_approval),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  }
}

function eventFromRow(row: EventRow): StoredWorkflowEvent {
  return {
    runId: row.run_id,
    eventIndex: Number(row.event_index),
    eventType: row.event_type,
    stepId: row.step_id ?? undefined,
    event: decodeJson(row.event) as WorkflowEvent,
    createdAt: Number(row.created_at),
  }
}

function timerFromRow(row: TimerRow): TimerWakeup {
  return {
    runId: row.run_id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version ?? undefined,
    wakeAt: Number(row.wake_at),
    signalId: row.signal_id,
  }
}

function scheduleFromRow(row: ScheduleRow) {
  return {
    scheduleId: row.schedule_id satisfies ScheduleId,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version ?? undefined,
    input: decodeJsonOrUndefined(row.input),
    overlapPolicy: row.overlap_policy,
    nextFireAt: Number(row.next_fire_at),
  }
}

function scheduleBucketFromRow(row: ScheduleBucketRow): ScheduleBucket {
  return {
    scheduleId: row.schedule_id,
    bucketId: row.bucket_id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version ?? undefined,
    runId: row.run_id,
    fireAt: Number(row.fire_at),
    input: decodeJsonOrUndefined(row.input),
    overlapPolicy: row.overlap_policy,
  }
}

function toRunSummary(row: RunRow): RunSummary {
  const run = runFromRow(row)
  return {
    runId: run.runId,
    workflowId: run.workflowId,
    workflowVersion: run.workflowVersion,
    status: run.status,
    awaiting: run.awaiting,
    waitingFor: run.waitingFor,
    pendingApproval: run.pendingApproval,
    wakeAt: run.wakeAt,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  }
}

function encodeJson(value: unknown) {
  return JSON.stringify(value ?? null)
}

function encodeJsonOrNull(value: unknown) {
  return value === undefined ? null : JSON.stringify(value)
}

function decodeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function decodeJsonOrUndefined<TValue = unknown>(
  value: unknown,
): TValue | undefined {
  if (value === null || value === undefined) return undefined
  return decodeJson(value) as TValue
}

function numberOrUndefined(value: number | string | null) {
  return value === null ? undefined : Number(value)
}

function getStepId(event: WorkflowEvent) {
  return 'stepId' in event ? event.stepId : undefined
}
