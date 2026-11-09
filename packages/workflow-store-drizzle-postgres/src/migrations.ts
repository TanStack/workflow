import {
  getDrizzlePostgresTimerFairnessStatements,
  getDrizzlePostgresWorkflowStoreSchemaStatements,
} from './schema-contract'
import type { DrizzlePostgresWorkflowStoreSchemaOptions } from './schema-contract'

export interface DrizzlePostgresWorkflowStoreMigration {
  id: string
  name: string
  order: number
  statements: Array<string>
  sql: string
}

export const drizzlePostgresWorkflowStoreSchemaVersion =
  '0001_fair_timer_claims'

export function getDrizzlePostgresWorkflowStoreMigrations(
  options?: DrizzlePostgresWorkflowStoreSchemaOptions,
): Array<DrizzlePostgresWorkflowStoreMigration> {
  const statements = getDrizzlePostgresWorkflowStoreSchemaStatements(options)

  return [
    {
      id: '0000_workflow_store',
      name: 'Create TanStack Workflow Drizzle/Postgres store tables',
      order: 0,
      statements,
      sql: `${statements.join(';\n\n')};\n`,
    },
    {
      id: '0001_fair_timer_claims',
      name: 'Fair timer claims',
      order: 1,
      statements: getDrizzlePostgresTimerFairnessStatements(options),
      sql: `${getDrizzlePostgresTimerFairnessStatements(options).join(';\n\n')};\n`,
    },
  ]
}

export function getDrizzlePostgresWorkflowStoreMigrationSql(
  options?: DrizzlePostgresWorkflowStoreSchemaOptions,
): string {
  return getDrizzlePostgresWorkflowStoreMigrations(options)
    .map((migration) => migration.sql)
    .join('\n')
}
