import {
  getDrizzlePostgresWorkflowStoreInboxSchemaStatements,
  getDrizzlePostgresWorkflowStoreInitialSchemaStatements,
} from './schema-contract'
import type { DrizzlePostgresWorkflowStoreSchemaOptions } from './schema-contract'

export interface DrizzlePostgresWorkflowStoreMigration {
  id: string
  name: string
  order: number
  statements: Array<string>
  sql: string
}

export const drizzlePostgresWorkflowStoreSchemaVersion = '0001_signal_inbox'

export function getDrizzlePostgresWorkflowStoreMigrations(
  options?: DrizzlePostgresWorkflowStoreSchemaOptions,
): Array<DrizzlePostgresWorkflowStoreMigration> {
  const statements =
    getDrizzlePostgresWorkflowStoreInitialSchemaStatements(options)
  const inboxStatements =
    getDrizzlePostgresWorkflowStoreInboxSchemaStatements(options)

  return [
    {
      id: '0000_workflow_store',
      name: 'Create TanStack Workflow Drizzle/Postgres store tables',
      order: 0,
      statements,
      sql: `${statements.join(';\n\n')};\n`,
    },
    {
      id: '0001_signal_inbox',
      name: 'Add durable signal inbox',
      order: 1,
      statements: inboxStatements,
      sql: `${inboxStatements.join(';\n\n')};\n`,
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
