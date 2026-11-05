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
  durability: true,
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

    const inboxSql = await readFile(
      new URL('../migrations/0001_signal_inbox.sql', import.meta.url),
      'utf8',
    )
    expect(getDrizzlePostgresWorkflowStoreMigrationSql()).toBe(
      `${migrationSql}\n${inboxSql}`,
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
        id: '0001_signal_inbox',
        name: 'Add durable signal inbox',
        order: 1,
        statements: expect.any(Array),
        sql: inboxSql,
      },
    ])
  })

  test('upgrades the initial schema without changing existing state or history', async () => {
    const client = new PGlite()
    const migrations = getDrizzlePostgresWorkflowStoreMigrations()
    await client.exec(migrations[0]!.sql)
    const store = createDrizzlePostgresWorkflowStore({ db: drizzle(client) })
    await store.createRun({
      runId: 'legacy',
      workflowId: 'flow',
      input: { value: 1 },
      now: 1,
    })
    await store.appendEvents({
      runId: 'legacy',
      expectedNextIndex: 0,
      events: [
        { type: 'STEP_FINISHED', ts: 1, stepId: 'old-step', result: 42 },
      ],
    })
    await client.exec(migrations[1]!.sql)
    await store.ensureSchema()
    expect((await store.loadRun('legacy'))?.input).toEqual({ value: 1 })
    expect(
      (await store.readEvents({ runId: 'legacy' }))[0]?.event,
    ).toMatchObject({ result: 42 })
    expect(
      (
        await store.bufferSignal!({
          runId: 'legacy',
          delivery: { signalId: 'new', name: 'ready', payload: 1 },
          now: 2,
        })
      ).kind,
    ).toBe('buffered')
    await client.close()
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
