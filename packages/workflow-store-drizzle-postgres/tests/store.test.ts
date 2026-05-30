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

    expect(getDrizzlePostgresWorkflowStoreMigrationSql()).toBe(migrationSql)
    expect(getDrizzlePostgresWorkflowStoreMigrations()).toEqual([
      {
        id: '0000_workflow_store',
        name: 'Create TanStack Workflow Drizzle/Postgres store tables',
        order: 0,
        statements: expect.any(Array),
        sql: migrationSql,
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
        migration_id: drizzlePostgresWorkflowStoreSchemaVersion,
        package_name: '@tanstack/workflow-store-drizzle-postgres',
      },
    ])
  })
})
