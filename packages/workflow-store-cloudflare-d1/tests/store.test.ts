import { DatabaseSync } from 'node:sqlite'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  cloudflareD1WorkflowStoreSchemaVersion,
  createCloudflareD1WorkflowStore,
  getCloudflareD1WorkflowStoreMigrationSql,
  getCloudflareD1WorkflowStoreMigrations,
} from '../src'
import { runWorkflowExecutionStoreContractTests } from '../../workflow-runtime/tests/contracts/workflow-execution-store.contract'
import type {
  CloudflareD1Database,
  CloudflareD1PreparedStatement,
} from '../src'

runWorkflowExecutionStoreContractTests({
  name: 'cloudflare-d1',
  createStore: async () => {
    const db = createTestD1Database()
    const store = createCloudflareD1WorkflowStore({ db })
    await store.ensureSchema()
    return store
  },
})

describe('cloudflare-d1 schema contract', () => {
  test('exports the package-owned migration sql', async () => {
    const migrationFile = fileURLToPath(
      new URL('../migrations/0000_workflow_store.sql', import.meta.url),
    )
    const migrationSql = await readFile(migrationFile, 'utf8')

    expect(getCloudflareD1WorkflowStoreMigrationSql()).toBe(
      getCloudflareD1WorkflowStoreMigrations()
        .map((migration) => migration.sql)
        .join('\n'),
    )
    expect(getCloudflareD1WorkflowStoreMigrations()[1]!.sql).toBe(
      await readFile(
        new URL('../migrations/0001_fair_timer_claims.sql', import.meta.url),
        'utf8',
      ),
    )
    expect(getCloudflareD1WorkflowStoreMigrations()).toEqual([
      {
        id: '0000_workflow_store',
        name: 'Create TanStack Workflow Cloudflare D1 store tables',
        order: 0,
        statements: expect.any(Array),
        sql: migrationSql,
      },
      {
        id: '0001_fair_timer_claims',
        name: 'Fair timer claims',
        order: 1,
        statements: expect.any(Array),
        sql: expect.any(String),
      },
    ])
  })

  test('can generate custom table migrations', () => {
    const sql = getCloudflareD1WorkflowStoreMigrationSql({
      tables: {
        runs: 'app_workflow_runs',
      },
    })

    expect(sql).toContain(
      'create table if not exists "workflow_schema_migrations"',
    )
    expect(sql).toContain('create table if not exists "app_workflow_runs"')
    expect(sql).toContain('create table if not exists "workflow_events"')
  })

  test('upgrades existing timers and preserves fairness across store instances', async () => {
    const db = createTestD1Database()
    await db.exec!(getCloudflareD1WorkflowStoreMigrations()[0]!.sql)
    await db.exec!(
      `insert into workflow_timers (run_id, signal_id, workflow_id, wake_at, lease_owner, lease_expires_at) values ('a', 'timer', 'workflow', 100, 'old-worker', 50), ('b', 'timer', 'workflow', 100, null, null)`,
    )
    const store = createCloudflareD1WorkflowStore({ db })
    await store.ensureSchema()
    await store.ensureSchema()
    const args = { now: 100, limit: 1, leaseOwner: 'worker', leaseMs: 50 }
    expect((await store.claimDueTimers(args)).map((t) => t.runId)).toEqual([
      'a',
    ])
    await store.releaseTimerLease({
      runId: 'a',
      signalId: 'timer',
      leaseOwner: 'worker',
      leaseExpiresAt: 150,
    })
    const restarted = createCloudflareD1WorkflowStore({ db })
    expect((await restarted.claimDueTimers(args)).map((t) => t.runId)).toEqual([
      'b',
    ])
  })

  test('rolls back every timer claim if a batch update fails', async () => {
    const db = createTestD1Database()
    const store = createCloudflareD1WorkflowStore({ db })
    await store.ensureSchema()
    for (const runId of ['a', 'b'])
      await store.scheduleTimer({
        runId,
        workflowId: 'workflow',
        signalId: 'timer',
        wakeAt: 100,
        now: 0,
      })
    await db.exec!(
      "create trigger fail_second_claim before update on workflow_timers when new.run_id = 'b' begin select raise(abort, 'claim failed'); end",
    )
    await expect(
      store.claimDueTimers({
        now: 100,
        limit: 2,
        leaseOwner: 'failed-worker',
        leaseMs: 50,
      }),
    ).rejects.toThrow('claim failed')
    await db.exec!('drop trigger fail_second_claim')
    expect(
      await store.claimDueTimers({
        now: 100,
        limit: 2,
        leaseOwner: 'next-worker',
        leaseMs: 50,
      }),
    ).toHaveLength(2)
  })

  test('upgrades separate timer tables sharing a migration ledger', async () => {
    const db = createTestD1Database()
    const first = createCloudflareD1WorkflowStore({ db })
    await first.ensureSchema()
    const second = createCloudflareD1WorkflowStore({
      db,
      tables: { timers: 'other_timers' },
    })
    await second.ensureSchema()
    await second.ensureSchema()
    await second.scheduleTimer({
      runId: 'a',
      workflowId: 'workflow',
      signalId: 'timer',
      wakeAt: 100,
      now: 0,
    })
    expect(
      await second.claimDueTimers({
        now: 100,
        limit: 1,
        leaseOwner: 'worker',
        leaseMs: 50,
      }),
    ).toHaveLength(1)
  })

  test('resumes a non-batch upgrade after the column was added', async () => {
    const db = createTestD1Database()
    db.batch = undefined
    await db.exec!(getCloudflareD1WorkflowStoreMigrations()[0]!.sql)
    await db.exec!(
      'alter table workflow_timers add column claim_order integer not null default 0',
    )
    const store = createCloudflareD1WorkflowStore({ db })
    await store.ensureSchema()
    await store.ensureSchema()
    const indexes = await db
      .prepare(
        "select name from sqlite_master where name = 'workflow_timers_claim_order_idx'",
      )
      .all()
    expect(indexes.results).toHaveLength(1)
    const ledger = await db
      .prepare(
        "select migration_id from workflow_schema_migrations where migration_id = '0001_fair_timer_claims'",
      )
      .all()
    expect(ledger.results).toHaveLength(1)
  })

  test('records the applied schema migration during ensureSchema', async () => {
    const db = createTestD1Database()
    const store = createCloudflareD1WorkflowStore({ db })

    await store.ensureSchema()
    await store.ensureSchema()

    const rows = await db
      .prepare(
        'select migration_id, package_name from workflow_schema_migrations order by migration_id',
      )
      .all<{ migration_id: string; package_name: string }>()

    expect(rows.results).toEqual([
      {
        migration_id: '0000_workflow_store',
        package_name: '@tanstack/workflow-store-cloudflare-d1',
      },
      {
        migration_id: cloudflareD1WorkflowStoreSchemaVersion,
        package_name: '@tanstack/workflow-store-cloudflare-d1',
      },
    ])
  })
})

function createTestD1Database(): CloudflareD1Database {
  const db = new DatabaseSync(':memory:')

  return {
    prepare(query) {
      return new TestD1PreparedStatement(db, query)
    },
    async batch(statements: Array<CloudflareD1PreparedStatement>) {
      db.exec('begin')
      try {
        const results = []
        for (const item of statements) {
          results.push(await item.run())
        }
        db.exec('commit')
        return results
      } catch (error) {
        db.exec('rollback')
        throw error
      }
    },
    async exec(query) {
      db.exec(query)
      return { count: query.split(';').filter(Boolean).length }
    },
  }
}

class TestD1PreparedStatement implements CloudflareD1PreparedStatement {
  private values: Array<unknown> = []

  constructor(
    private readonly db: DatabaseSync,
    private readonly query: string,
  ) {}

  bind(...values: Array<unknown>) {
    const statement = new TestD1PreparedStatement(this.db, this.query)
    statement.values = values
    return statement
  }

  async all<TRow = Record<string, unknown>>() {
    const statement = this.db.prepare(this.query)
    const results = statement.all(...toSqliteValues(this.values)) as Array<TRow>
    return { success: true as const, meta: {}, results }
  }

  async first<TRow = Record<string, unknown>>(_colName?: string) {
    const statement = this.db.prepare(this.query)
    return (
      (statement.get(...toSqliteValues(this.values)) as TRow | undefined) ??
      null
    )
  }

  async raw<TRow = Array<unknown>>(_options: {
    columnNames: true
  }): Promise<[Array<string>, ...Array<TRow>]>
  async raw<TRow = Array<unknown>>(_options?: {
    columnNames?: false
  }): Promise<Array<TRow>>
  async raw<TRow = Array<unknown>>(_options?: {
    columnNames?: boolean
  }): Promise<Array<TRow> | [Array<string>, ...Array<TRow>]> {
    const statement = this.db.prepare(this.query)
    return statement.all(...toSqliteValues(this.values)) as Array<TRow>
  }

  async run<TRow = Record<string, unknown>>() {
    const statement = this.db.prepare(this.query)
    statement.run(...toSqliteValues(this.values))
    return { success: true as const, meta: {}, results: [] as Array<TRow> }
  }
}

function toSqliteValues(values: Array<unknown>) {
  return values.map((value) => {
    if (typeof value === 'boolean') return value ? 1 : 0
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      value === null
    ) {
      return value
    }
    return JSON.stringify(value)
  })
}
