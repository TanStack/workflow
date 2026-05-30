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

    expect(getCloudflareD1WorkflowStoreMigrationSql()).toBe(migrationSql)
    expect(getCloudflareD1WorkflowStoreMigrations()).toEqual([
      {
        id: '0000_workflow_store',
        name: 'Create TanStack Workflow Cloudflare D1 store tables',
        order: 0,
        statements: expect.any(Array),
        sql: migrationSql,
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

  test('records the applied schema migration during ensureSchema', async () => {
    const db = createTestD1Database()
    const store = createCloudflareD1WorkflowStore({ db })

    await store.ensureSchema()

    const rows = await db
      .prepare(
        'select migration_id, package_name from workflow_schema_migrations order by migration_id',
      )
      .all<{ migration_id: string; package_name: string }>()

    expect(rows.results).toEqual([
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
