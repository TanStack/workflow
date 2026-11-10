import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  createDrizzlePostgresWorkflowStore,
  drizzlePostgresWorkflowStoreSchemaVersion,
  getDrizzlePostgresWorkflowStoreMigrationSql,
  getDrizzlePostgresWorkflowStoreMigrations,
} from '../src'
import { runWorkflowExecutionStoreContractTests } from '../../workflow-runtime/tests/contracts/workflow-execution-store.contract'

runWorkflowExecutionStoreContractTests({
  name: 'drizzle-postgres',
  createStore: async () => {
    const db = drizzle(new PGlite())
    const store = createDrizzlePostgresWorkflowStore({ db })
    await store.ensureSchema()
    return store
  },
})

describe('drizzle-postgres schema contract', () => {
  test('exports the package-owned migration sql', async () => {
    const migrationFile = fileURLToPath(
      new URL('../migrations/0000_workflow_store.sql', import.meta.url),
    )
    const migrationSql = await readFile(migrationFile, 'utf8')

    expect(getDrizzlePostgresWorkflowStoreMigrationSql()).toBe(
      getDrizzlePostgresWorkflowStoreMigrations()
        .map((migration) => migration.sql)
        .join('\n'),
    )
    expect(getDrizzlePostgresWorkflowStoreMigrations()[1]!.sql).toBe(
      await readFile(
        new URL('../migrations/0001_fair_timer_claims.sql', import.meta.url),
        'utf8',
      ),
    )
    expect(getDrizzlePostgresWorkflowStoreMigrations()).toEqual([
      {
        id: '0000_workflow_store',
        name: 'Create TanStack Workflow Drizzle/Postgres store tables',
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

  test('can generate schema-qualified custom table migrations', () => {
    const sql = getDrizzlePostgresWorkflowStoreMigrationSql({
      schema: 'workflow',
      tables: {
        runs: 'runs',
      },
    })

    expect(sql).toContain('create schema if not exists "workflow"')
    expect(sql).toContain(
      'create table if not exists "workflow"."workflow_schema_migrations"',
    )
    expect(sql).toContain('create table if not exists "workflow"."runs"')
    expect(sql).toContain(
      'create table if not exists "workflow"."workflow_events"',
    )
  })

  test('upgrades existing timers and preserves fairness across store instances', async () => {
    const client = new PGlite()
    const db = drizzle(client)
    await client.exec(getDrizzlePostgresWorkflowStoreMigrations()[0]!.sql)
    await client.exec(
      `insert into workflow_timers (run_id, signal_id, workflow_id, wake_at, lease_owner, lease_expires_at) values ('a', 'timer', 'workflow', 100, 'old-worker', 50), ('b', 'timer', 'workflow', 100, null, null)`,
    )
    const store = createDrizzlePostgresWorkflowStore({ db })
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
    const restarted = createDrizzlePostgresWorkflowStore({ db })
    expect((await restarted.claimDueTimers(args)).map((t) => t.runId)).toEqual([
      'b',
    ])
  })

  test('upgrades separate timer tables sharing a migration ledger', async () => {
    const client = new PGlite()
    const db = drizzle(client)
    const first = createDrizzlePostgresWorkflowStore({ db })
    await first.ensureSchema()
    const second = createDrizzlePostgresWorkflowStore({
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

  test('retries the exported migration after a partial application', async () => {
    const client = new PGlite()
    const migrations = getDrizzlePostgresWorkflowStoreMigrations()
    await client.exec(migrations[0]!.sql)
    await client.exec(migrations[1]!.statements[0]!)
    await client.exec(migrations[1]!.sql)
    await client.exec(migrations[1]!.sql)
    const result = await client.query('select claim_order from workflow_timers')
    expect(result.rows).toEqual([])
  })

  test('records the applied schema migration during ensureSchema', async () => {
    const client = new PGlite()
    const db = drizzle(client)
    const store = createDrizzlePostgresWorkflowStore({ db })

    await store.ensureSchema()

    const result = await client.query<{
      migration_id: string
      package_name: string
    }>(
      'select migration_id, package_name from workflow_schema_migrations order by migration_id',
    )

    expect(result.rows).toEqual([
      {
        migration_id: '0000_workflow_store',
        package_name: '@tanstack/workflow-store-drizzle-postgres',
      },
      {
        migration_id: drizzlePostgresWorkflowStoreSchemaVersion,
        package_name: '@tanstack/workflow-store-drizzle-postgres',
      },
    ])
  })
})
