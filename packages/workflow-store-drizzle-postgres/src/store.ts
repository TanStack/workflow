import { LogConflictError } from '@tanstack/workflow-core'
import { sql } from 'drizzle-orm'
import type { RunState, WorkflowEvent } from '@tanstack/workflow-core'
import type { SQL } from 'drizzle-orm'
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

export interface DrizzlePostgresDatabase {
  execute: (query: SQL | string) => PromiseLike<unknown>
  transaction?: <TResult>(
    callback: (tx: DrizzlePostgresDatabase) => Promise<TResult>,
  ) => Promise<TResult>
}

export interface DrizzlePostgresWorkflowStoreTables {
  runs: string
  runStates: string
  eventLocks: string
  events: string
  timers: string
  signalDeliveries: string
  schedules: string
  scheduleBuckets: string
}

export interface DrizzlePostgresWorkflowStoreOptions {
  db: DrizzlePostgresDatabase
  schema?: string
  tables?: Partial<DrizzlePostgresWorkflowStoreTables>
}

export type DrizzlePostgresWorkflowStore = WorkflowExecutionStore &
  WorkflowRunStoreAdapterStore & {
    ensureSchema: () => Promise<void>
  }

export const defaultDrizzlePostgresWorkflowStoreTables: DrizzlePostgresWorkflowStoreTables =
  {
    runs: 'workflow_runs',
    runStates: 'workflow_run_states',
    eventLocks: 'workflow_event_locks',
    events: 'workflow_events',
    timers: 'workflow_timers',
    signalDeliveries: 'workflow_signal_deliveries',
    schedules: 'workflow_schedules',
    scheduleBuckets: 'workflow_schedule_buckets',
  }

export function createDrizzlePostgresWorkflowStore(
  options: DrizzlePostgresWorkflowStoreOptions,
): DrizzlePostgresWorkflowStore {
  const tableNames = {
    ...defaultDrizzlePostgresWorkflowStoreTables,
    ...options.tables,
  }
  const tableSql = tableSqls(options.schema, tableNames)
  const db = options.db

  return {
    async ensureSchema() {
      for (const statement of schemaStatements(options.schema, tableNames)) {
        await db.execute(sql.raw(statement))
      }
    },

    async createRun(args: CreateRunArgs): Promise<CreateRunResult> {
      const rows = await queryRows<RunRow>(
        db,
        sql`
          insert into ${tableSql.runs} (
            run_id,
            workflow_id,
            workflow_version,
            status,
            input,
            created_at,
            updated_at
          )
          values (
            ${args.runId},
            ${args.workflowId},
            ${args.workflowVersion ?? null},
            'queued',
            ${encodeJson(args.input)}::jsonb,
            ${args.now},
            ${args.now}
          )
          on conflict (run_id) do nothing
          returning *
        `,
      )
      if (rows[0]) return { kind: 'created', run: runFromRow(rows[0]) }

      const existing = await loadRunById(db, tableSql, args.runId)
      if (!existing) {
        throw new Error(`Run "${args.runId}" was not inserted or loaded.`)
      }
      return { kind: 'existing', run: existing }
    },

    loadRun(runId: RunId) {
      return loadRunById(db, tableSql, runId)
    },

    async loadExecution(runId: RunId): Promise<LoadedExecution | undefined> {
      const run = await loadRunById(db, tableSql, runId)
      if (!run) return undefined
      return {
        run,
        events: await readStoredEvents(db, tableSql, { runId }),
      }
    },

    async loadRunState(runId: RunId) {
      return loadRunStateById(db, tableSql, runId)
    },

    async saveRunState(args: SaveRunStateArgs) {
      const state = args.state
      await withTransaction(db, async (tx) => {
        await tx.execute(sql`
          insert into ${tableSql.runStates} (
            run_id,
            workflow_id,
            workflow_version,
            status,
            input,
            output,
            error,
            waiting_for,
            pending_approval,
            created_at,
            updated_at
          )
          values (
            ${state.runId},
            ${state.workflowId},
            ${state.workflowVersion ?? null},
            ${state.status},
            ${encodeJson(state.input)}::jsonb,
            ${encodeJsonOrNull(state.output)}::jsonb,
            ${encodeJsonOrNull(state.error)}::jsonb,
            ${encodeJsonOrNull(state.waitingFor)}::jsonb,
            ${encodeJsonOrNull(state.pendingApproval)}::jsonb,
            ${state.createdAt},
            ${state.updatedAt}
          )
          on conflict (run_id) do update set
            workflow_id = excluded.workflow_id,
            workflow_version = excluded.workflow_version,
            status = excluded.status,
            input = excluded.input,
            output = excluded.output,
            error = excluded.error,
            waiting_for = excluded.waiting_for,
            pending_approval = excluded.pending_approval,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `)
        await tx.execute(sql`
          insert into ${tableSql.runs} (
            run_id,
            workflow_id,
            workflow_version,
            status,
            input,
            output,
            error,
            waiting_for,
            pending_approval,
            wake_at,
            created_at,
            updated_at
          )
          values (
            ${state.runId},
            ${state.workflowId},
            ${state.workflowVersion ?? null},
            ${state.status},
            ${encodeJson(state.input)}::jsonb,
            ${encodeJsonOrNull(state.output)}::jsonb,
            ${encodeJsonOrNull(state.error)}::jsonb,
            ${encodeJsonOrNull(state.waitingFor)}::jsonb,
            ${encodeJsonOrNull(state.pendingApproval)}::jsonb,
            ${
              state.waitingFor?.signalName === '__timer'
                ? state.waitingFor.deadline
                : null
            },
            ${state.createdAt},
            ${state.updatedAt}
          )
          on conflict (run_id) do update set
            workflow_id = excluded.workflow_id,
            workflow_version = excluded.workflow_version,
            status = excluded.status,
            input = excluded.input,
            output = excluded.output,
            error = excluded.error,
            waiting_for = excluded.waiting_for,
            pending_approval = excluded.pending_approval,
            wake_at = excluded.wake_at,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at
        `)
      })
    },

    async deleteRun(runId, _reason) {
      await withTransaction(db, async (tx) => {
        await tx.execute(sql`
          delete from ${tableSql.runStates}
          where run_id = ${runId}
        `)
        await tx.execute(sql`
          delete from ${tableSql.eventLocks}
          where run_id = ${runId}
        `)
        await tx.execute(sql`
          delete from ${tableSql.signalDeliveries}
          where run_id = ${runId}
        `)
        await tx.execute(sql`
          delete from ${tableSql.timers}
          where run_id = ${runId}
        `)
        await tx.execute(sql`
          delete from ${tableSql.events}
          where run_id = ${runId}
        `)
        await tx.execute(sql`
          delete from ${tableSql.runs}
          where run_id = ${runId}
        `)
      })
    },

    async appendEvents(args: AppendEventsArgs): Promise<AppendEventsResult> {
      return withTransaction(db, async (tx) => {
        await tx.execute(sql`
          insert into ${tableSql.eventLocks} (run_id, created_at)
          values (${args.runId}, ${Date.now()})
          on conflict (run_id) do nothing
        `)
        await queryRows<{ run_id: string }>(
          tx,
          sql`
            select run_id
            from ${tableSql.eventLocks}
            where run_id = ${args.runId}
            for update
          `,
        )

        const countRows = await queryRows<{ count: number | string }>(
          tx,
          sql`
            select count(*)::int as count
            from ${tableSql.events}
            where run_id = ${args.runId}
          `,
        )
        const currentCount = Number(countRows[0]?.count ?? 0)

        if (currentCount !== args.expectedNextIndex) {
          const conflict = await queryRows<EventRow>(
            tx,
            sql`
              select *
              from ${tableSql.events}
              where run_id = ${args.runId}
                and event_index = ${args.expectedNextIndex}
              limit 1
            `,
          )
          throw new LogConflictError(
            args.runId,
            args.expectedNextIndex,
            conflict[0] ? eventFromRow(conflict[0]).event : undefined,
          )
        }

        let nextIndex = args.expectedNextIndex
        for (const event of args.events) {
          await tx.execute(sql`
            insert into ${tableSql.events} (
              run_id,
              event_index,
              event_type,
              step_id,
              event,
              created_at
            )
            values (
              ${args.runId},
              ${nextIndex},
              ${event.type},
              ${getStepId(event) ?? null},
              ${encodeJson(event)}::jsonb,
              ${event.ts}
            )
          `)
          nextIndex++
        }

        return { nextIndex }
      })
    },

    readEvents(args: ReadEventsArgs) {
      return readStoredEvents(db, tableSql, args)
    },

    async claimRun(args: ClaimRunArgs): Promise<ClaimRunResult> {
      const rows = await queryRows<RunRow>(
        db,
        sql`
          update ${tableSql.runs}
          set
            status = 'running',
            lease_owner = ${args.leaseOwner},
            lease_expires_at = ${args.now + args.leaseMs},
            updated_at = ${args.now}
          where run_id = ${args.runId}
            and status not in ('finished', 'errored', 'aborted')
            and (
              lease_owner is null
              or lease_owner = ${args.leaseOwner}
              or lease_expires_at <= ${args.now}
            )
          returning *
        `,
      )
      if (rows[0]) return { kind: 'claimed', run: runFromRow(rows[0]) }

      const run = await loadRunById(db, tableSql, args.runId)
      return run ? { kind: 'not-claimable', run } : { kind: 'not-found' }
    },

    async heartbeatRunLease(args: HeartbeatRunLeaseArgs) {
      await db.execute(sql`
        update ${tableSql.runs}
        set
          lease_expires_at = ${args.now + args.leaseMs},
          updated_at = ${args.now}
        where run_id = ${args.runId}
          and lease_owner = ${args.leaseOwner}
      `)
    },

    async releaseRunLease(args: ReleaseRunLeaseArgs) {
      await db.execute(sql`
        update ${tableSql.runs}
        set
          lease_owner = null,
          lease_expires_at = null
        where run_id = ${args.runId}
          and lease_owner = ${args.leaseOwner}
      `)
    },

    async markRunPaused(args: MarkRunPausedArgs) {
      await db.execute(sql`
        update ${tableSql.runs}
        set
          status = 'paused',
          waiting_for = ${encodeJsonOrNull(args.waitingFor)}::jsonb,
          pending_approval = ${encodeJsonOrNull(args.pendingApproval)}::jsonb,
          wake_at = ${args.wakeAt ?? null},
          lease_owner = null,
          lease_expires_at = null,
          updated_at = ${args.now}
        where run_id = ${args.runId}
      `)
    },

    async markRunFinished(args: MarkRunFinishedArgs) {
      await db.execute(sql`
        update ${tableSql.runs}
        set
          status = 'finished',
          output = ${encodeJson(args.output)}::jsonb,
          waiting_for = null,
          pending_approval = null,
          wake_at = null,
          lease_owner = null,
          lease_expires_at = null,
          updated_at = ${args.now}
        where run_id = ${args.runId}
      `)
    },

    async markRunErrored(args: MarkRunErroredArgs) {
      void args.code
      await db.execute(sql`
        update ${tableSql.runs}
        set
          status = 'errored',
          error = ${encodeJson(args.error)}::jsonb,
          waiting_for = null,
          pending_approval = null,
          wake_at = null,
          lease_owner = null,
          lease_expires_at = null,
          updated_at = ${args.now}
        where run_id = ${args.runId}
      `)
    },

    async scheduleTimer(args: ScheduleTimerArgs) {
      await withTransaction(db, async (tx) => {
        await tx.execute(sql`
          insert into ${tableSql.timers} (
            run_id,
            signal_id,
            workflow_id,
            workflow_version,
            wake_at
          )
          values (
            ${args.runId},
            ${args.signalId},
            ${args.workflowId},
            ${args.workflowVersion ?? null},
            ${args.wakeAt}
          )
          on conflict (run_id, signal_id) do update set
            workflow_id = excluded.workflow_id,
            workflow_version = excluded.workflow_version,
            wake_at = excluded.wake_at,
            lease_owner = null,
            lease_expires_at = null
        `)
        await tx.execute(sql`
          update ${tableSql.runs}
          set
            wake_at = ${args.wakeAt},
            updated_at = ${args.now}
          where run_id = ${args.runId}
        `)
      })
    },

    async claimDueTimers(args: ClaimDueTimersArgs) {
      const rows = await queryRows<TimerRow>(
        db,
        sql`
          with due as (
            select run_id, signal_id
            from ${tableSql.timers}
            where wake_at <= ${args.now}
              and (
                lease_owner is null
                or lease_owner = ${args.leaseOwner}
                or lease_expires_at <= ${args.now}
              )
            order by wake_at asc, run_id asc, signal_id asc
            limit ${args.limit}
            for update skip locked
          )
          update ${tableSql.timers} timer
          set
            lease_owner = ${args.leaseOwner},
            lease_expires_at = ${args.now + args.leaseMs}
          from due
          where timer.run_id = due.run_id
            and timer.signal_id = due.signal_id
          returning timer.*
        `,
      )
      return rows.map(timerFromRow)
    },

    async deliverSignal<TPayload>(
      args: DeliverSignalArgs<TPayload>,
    ): Promise<DeliverSignalResult> {
      return withTransaction(db, async (tx) => {
        const run = await loadRunById(tx, tableSql, args.runId)
        if (!run) return { kind: 'not-found' }

        const existingDelivery = await loadSignalDelivery(
          tx,
          tableSql,
          args.runId,
          args.delivery.signalId,
        )
        if (existingDelivery) return { kind: 'duplicate', run }

        if (run.waitingFor?.signalName !== args.delivery.name) {
          return { kind: 'not-waiting', run }
        }

        const inserted = await insertSignalDelivery(
          tx,
          tableSql,
          args.runId,
          args.delivery.signalId,
          args.now,
        )
        if (!inserted) return { kind: 'duplicate', run }

        await tx.execute(sql`
          delete from ${tableSql.timers}
          where run_id = ${args.runId}
            and signal_id = ${args.delivery.signalId}
        `)

        const rows = await queryRows<RunRow>(
          tx,
          sql`
            update ${tableSql.runs}
            set
              status = 'queued',
              waiting_for = null,
              pending_approval = null,
              wake_at = null,
              updated_at = ${args.now}
            where run_id = ${args.runId}
            returning *
          `,
        )

        return { kind: 'delivered', run: runFromRow(rows[0]!) }
      })
    },

    async deliverApproval(
      args: DeliverApprovalArgs,
    ): Promise<DeliverApprovalResult> {
      return withTransaction(db, async (tx) => {
        const run = await loadRunById(tx, tableSql, args.runId)
        if (!run) return { kind: 'not-found' }

        const signalId = `approval:${args.approval.approvalId}`
        const existingDelivery = await loadSignalDelivery(
          tx,
          tableSql,
          args.runId,
          signalId,
        )
        if (existingDelivery) return { kind: 'duplicate', run }

        if (run.pendingApproval?.approvalId !== args.approval.approvalId) {
          return { kind: 'not-waiting', run }
        }

        const inserted = await insertSignalDelivery(
          tx,
          tableSql,
          args.runId,
          signalId,
          args.now,
        )
        if (!inserted) return { kind: 'duplicate', run }

        const rows = await queryRows<RunRow>(
          tx,
          sql`
            update ${tableSql.runs}
            set
              status = 'queued',
              waiting_for = null,
              pending_approval = null,
              wake_at = null,
              updated_at = ${args.now}
            where run_id = ${args.runId}
            returning *
          `,
        )

        return { kind: 'delivered', run: runFromRow(rows[0]!) }
      })
    },

    async upsertSchedule(args: UpsertScheduleArgs) {
      await db.execute(sql`
        insert into ${tableSql.schedules} (
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
        values (
          ${args.scheduleId},
          ${args.workflowId},
          ${args.workflowVersion ?? null},
          ${encodeJson(args.schedule)}::jsonb,
          ${args.overlapPolicy},
          ${encodeJsonOrNull(args.input)}::jsonb,
          ${args.nextFireAt ?? null},
          ${args.enabled},
          ${args.now}
        )
        on conflict (schedule_id) do update set
          workflow_id = excluded.workflow_id,
          workflow_version = excluded.workflow_version,
          schedule = excluded.schedule,
          overlap_policy = excluded.overlap_policy,
          input = excluded.input,
          next_fire_at = excluded.next_fire_at,
          enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `)
    },

    async claimDueScheduleBuckets(args: ClaimDueScheduleBucketsArgs) {
      const schedules = await queryRows<ScheduleRow>(
        db,
        sql`
          select schedule.*
          from ${tableSql.schedules} schedule
          left join ${tableSql.scheduleBuckets} bucket
            on bucket.schedule_id = schedule.schedule_id
            and bucket.bucket_id = schedule.next_fire_at::text
          where schedule.enabled = true
            and schedule.next_fire_at is not null
            and schedule.next_fire_at <= ${args.now}
            and (
              bucket.schedule_id is null
              or (
                bucket.status <> 'started'
                and (
                  bucket.lease_owner is null
                  or bucket.lease_owner = ${args.leaseOwner}
                  or bucket.lease_expires_at <= ${args.now}
                )
              )
            )
          order by schedule.next_fire_at asc, schedule.schedule_id asc
          limit ${args.limit}
        `,
      )
      const buckets: Array<ScheduleBucket> = []

      for (const scheduleRow of schedules) {
        if (buckets.length >= args.limit) break

        const schedule = scheduleFromRow(scheduleRow)
        const bucketId = `${schedule.nextFireAt}` satisfies ScheduleBucketId
        const runId = `${schedule.workflowId}:${schedule.scheduleId}:${bucketId}`

        await db.execute(sql`
          insert into ${tableSql.scheduleBuckets} (
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
          values (
            ${schedule.scheduleId},
            ${bucketId},
            ${schedule.workflowId},
            ${schedule.workflowVersion ?? null},
            ${runId},
            ${schedule.nextFireAt},
            ${encodeJsonOrNull(schedule.input)}::jsonb,
            ${schedule.overlapPolicy},
            'claimed'
          )
          on conflict (schedule_id, bucket_id) do nothing
        `)

        const rows = await queryRows<ScheduleBucketRow>(
          db,
          sql`
            update ${tableSql.scheduleBuckets}
            set
              lease_owner = ${args.leaseOwner},
              lease_expires_at = ${args.now + args.leaseMs}
            where schedule_id = ${schedule.scheduleId}
              and bucket_id = ${bucketId}
              and status <> 'started'
              and (
                lease_owner is null
                or lease_owner = ${args.leaseOwner}
                or lease_expires_at <= ${args.now}
              )
            returning *
          `,
        )
        if (rows[0]) buckets.push(scheduleBucketFromRow(rows[0]))
      }

      return buckets
    },

    async markScheduleBucketStarted(args: MarkScheduleBucketStartedArgs) {
      await db.execute(sql`
        update ${tableSql.scheduleBuckets}
        set
          run_id = ${args.runId},
          status = 'started',
          started_at = ${args.now}
        where schedule_id = ${args.scheduleId}
          and bucket_id = ${args.bucketId}
      `)
    },

    async claimStaleRuns(args: ClaimStaleRunsArgs) {
      const rows = await queryRows<RunRow>(
        db,
        sql`
          with stale as (
            select run_id
            from ${tableSql.runs}
            where status = 'running'
              and lease_expires_at is not null
              and lease_expires_at <= ${args.now}
            order by updated_at asc, run_id asc
            limit ${args.limit}
            for update skip locked
          )
          update ${tableSql.runs} run
          set
            lease_owner = ${args.leaseOwner},
            lease_expires_at = ${args.now + args.leaseMs},
            updated_at = ${args.now}
          from stale
          where run.run_id = stale.run_id
          returning run.*
        `,
      )

      return rows.map((row): RunClaim => {
        const run = runFromRow(row)
        return { run, lease: run.lease! }
      })
    },

    async listRuns(args: ListRunsArgs) {
      const offset = args.cursor ? Number(args.cursor) : 0
      const start = Number.isFinite(offset) && offset > 0 ? offset : 0
      const rows = await queryRows<RunRow>(
        db,
        sql`
          select *
          from ${tableSql.runs}
          where (${args.workflowId ?? null}::text is null or workflow_id = ${args.workflowId ?? null})
            and (${args.status ?? null}::text is null or status = ${args.status ?? null})
          order by updated_at desc, run_id asc
          limit ${args.limit}
          offset ${start}
        `,
      )

      return rows.map(toRunSummary)
    },

    async getRunTimeline(runId: RunId): Promise<RunTimeline | undefined> {
      const run = await loadRunById(db, tableSql, runId)
      if (!run) return undefined
      return {
        run,
        events: await readStoredEvents(db, tableSql, { runId }),
      }
    },
  }
}

interface TableSqls {
  runs: SQL
  runStates: SQL
  eventLocks: SQL
  events: SQL
  timers: SQL
  signalDeliveries: SQL
  schedules: SQL
  scheduleBuckets: SQL
}

interface RunRow {
  run_id: string
  workflow_id: string
  workflow_version: string | null
  status: WorkflowExecutionStatus
  input: unknown
  output: unknown
  error: unknown
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

function tableSqls(
  schema: string | undefined,
  tables: DrizzlePostgresWorkflowStoreTables,
): TableSqls {
  return {
    runs: sql.raw(qualifiedTableName(schema, tables.runs)),
    runStates: sql.raw(qualifiedTableName(schema, tables.runStates)),
    eventLocks: sql.raw(qualifiedTableName(schema, tables.eventLocks)),
    events: sql.raw(qualifiedTableName(schema, tables.events)),
    timers: sql.raw(qualifiedTableName(schema, tables.timers)),
    signalDeliveries: sql.raw(
      qualifiedTableName(schema, tables.signalDeliveries),
    ),
    schedules: sql.raw(qualifiedTableName(schema, tables.schedules)),
    scheduleBuckets: sql.raw(
      qualifiedTableName(schema, tables.scheduleBuckets),
    ),
  }
}

function schemaStatements(
  schema: string | undefined,
  tables: DrizzlePostgresWorkflowStoreTables,
): Array<string> {
  const runs = qualifiedTableName(schema, tables.runs)
  const runStates = qualifiedTableName(schema, tables.runStates)
  const eventLocks = qualifiedTableName(schema, tables.eventLocks)
  const events = qualifiedTableName(schema, tables.events)
  const timers = qualifiedTableName(schema, tables.timers)
  const signalDeliveries = qualifiedTableName(schema, tables.signalDeliveries)
  const schedules = qualifiedTableName(schema, tables.schedules)
  const scheduleBuckets = qualifiedTableName(schema, tables.scheduleBuckets)

  return [
    ...(schema ? [`create schema if not exists ${quoteIdent(schema)}`] : []),
    `create table if not exists ${runs} (
      run_id text primary key,
      workflow_id text not null,
      workflow_version text,
      status text not null,
      input jsonb not null,
      output jsonb,
      error jsonb,
      waiting_for jsonb,
      pending_approval jsonb,
      wake_at bigint,
      lease_owner text,
      lease_expires_at bigint,
      created_at bigint not null,
      updated_at bigint not null
    )`,
    `create index if not exists ${quoteIdent(`${tables.runs}_status_idx`)}
      on ${runs} (status, updated_at)`,
    `create index if not exists ${quoteIdent(`${tables.runs}_lease_idx`)}
      on ${runs} (status, lease_expires_at)`,
    `create table if not exists ${runStates} (
      run_id text primary key,
      workflow_id text not null,
      workflow_version text,
      status text not null,
      input jsonb not null,
      output jsonb,
      error jsonb,
      waiting_for jsonb,
      pending_approval jsonb,
      created_at bigint not null,
      updated_at bigint not null
    )`,
    `create table if not exists ${eventLocks} (
      run_id text primary key,
      created_at bigint not null
    )`,
    `create table if not exists ${events} (
      run_id text not null,
      event_index integer not null,
      event_type text not null,
      step_id text,
      event jsonb not null,
      created_at bigint not null,
      primary key (run_id, event_index)
    )`,
    `create index if not exists ${quoteIdent(`${tables.events}_type_idx`)}
      on ${events} (run_id, event_type)`,
    `create table if not exists ${timers} (
      run_id text not null,
      signal_id text not null,
      workflow_id text not null,
      workflow_version text,
      wake_at bigint not null,
      lease_owner text,
      lease_expires_at bigint,
      primary key (run_id, signal_id)
    )`,
    `create index if not exists ${quoteIdent(`${tables.timers}_due_idx`)}
      on ${timers} (wake_at, lease_expires_at)`,
    `create table if not exists ${signalDeliveries} (
      run_id text not null,
      signal_id text not null,
      created_at bigint not null,
      primary key (run_id, signal_id)
    )`,
    `create table if not exists ${schedules} (
      schedule_id text primary key,
      workflow_id text not null,
      workflow_version text,
      schedule jsonb not null,
      overlap_policy text not null,
      input jsonb,
      next_fire_at bigint,
      enabled boolean not null,
      updated_at bigint not null
    )`,
    `create index if not exists ${quoteIdent(`${tables.schedules}_due_idx`)}
      on ${schedules} (enabled, next_fire_at)`,
    `create table if not exists ${scheduleBuckets} (
      schedule_id text not null,
      bucket_id text not null,
      workflow_id text not null,
      workflow_version text,
      run_id text not null,
      fire_at bigint not null,
      input jsonb,
      overlap_policy text not null,
      status text not null,
      lease_owner text,
      lease_expires_at bigint,
      started_at bigint,
      primary key (schedule_id, bucket_id)
    )`,
    `create index if not exists ${quoteIdent(
      `${tables.scheduleBuckets}_lease_idx`,
    )}
      on ${scheduleBuckets} (status, fire_at, lease_expires_at)`,
  ]
}

async function loadRunById(
  db: DrizzlePostgresDatabase,
  tables: TableSqls,
  runId: RunId,
) {
  const rows = await queryRows<RunRow>(
    db,
    sql`
      select *
      from ${tables.runs}
      where run_id = ${runId}
      limit 1
    `,
  )
  return rows[0] ? runFromRow(rows[0]) : undefined
}

async function loadRunStateById(
  db: DrizzlePostgresDatabase,
  tables: TableSqls,
  runId: RunId,
): Promise<RunState | undefined> {
  const rows = await queryRows<RunStateRow>(
    db,
    sql`
      select *
      from ${tables.runStates}
      where run_id = ${runId}
      limit 1
    `,
  )
  return rows[0] ? runStateFromRow(rows[0]) : undefined
}

async function readStoredEvents(
  db: DrizzlePostgresDatabase,
  tables: TableSqls,
  args: ReadEventsArgs,
): Promise<ReadonlyArray<StoredWorkflowEvent>> {
  const rows = await queryRows<EventRow>(
    db,
    sql`
      select *
      from ${tables.events}
      where run_id = ${args.runId}
        and event_index >= ${args.fromIndex ?? 0}
      order by event_index asc
    `,
  )
  return rows.map(eventFromRow)
}

async function loadSignalDelivery(
  db: DrizzlePostgresDatabase,
  tables: TableSqls,
  runId: RunId,
  signalId: string,
) {
  const rows = await queryRows<{ run_id: string }>(
    db,
    sql`
      select run_id
      from ${tables.signalDeliveries}
      where run_id = ${runId}
        and signal_id = ${signalId}
      limit 1
    `,
  )
  return Boolean(rows[0])
}

async function insertSignalDelivery(
  db: DrizzlePostgresDatabase,
  tables: TableSqls,
  runId: RunId,
  signalId: string,
  now: number,
) {
  const rows = await queryRows<{ run_id: string }>(
    db,
    sql`
      insert into ${tables.signalDeliveries} (run_id, signal_id, created_at)
      values (${runId}, ${signalId}, ${now})
      on conflict (run_id, signal_id) do nothing
      returning run_id
    `,
  )
  return Boolean(rows[0])
}

async function withTransaction<TResult>(
  db: DrizzlePostgresDatabase,
  callback: (tx: DrizzlePostgresDatabase) => Promise<TResult>,
) {
  if (db.transaction) return db.transaction(callback)

  await db.execute(sql.raw('begin'))
  try {
    const result = await callback(db)
    await db.execute(sql.raw('commit'))
    return result
  } catch (error) {
    await db.execute(sql.raw('rollback'))
    throw error
  }
}

async function queryRows<TRow>(
  db: DrizzlePostgresDatabase,
  query: SQL,
): Promise<Array<TRow>> {
  const result = await db.execute(query)
  return rowsFromResult<TRow>(result)
}

function rowsFromResult<TRow>(result: unknown): Array<TRow> {
  if (Array.isArray(result)) return result as Array<TRow>

  if (isObjectWithRows(result) && Array.isArray(result.rows)) {
    return result.rows as Array<TRow>
  }

  return []
}

function isObjectWithRows(value: unknown): value is { rows: unknown } {
  return typeof value === 'object' && value !== null && 'rows' in value
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

function qualifiedTableName(schema: string | undefined, table: string) {
  return schema
    ? `${quoteIdent(schema)}.${quoteIdent(table)}`
    : quoteIdent(table)
}

function quoteIdent(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}
