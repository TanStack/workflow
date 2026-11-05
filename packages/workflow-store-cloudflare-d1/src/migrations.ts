import {
  getCloudflareD1WorkflowStoreInboxSchemaStatements,
  getCloudflareD1WorkflowStoreInitialSchemaStatements,
} from './schema-contract'
import type { CloudflareD1WorkflowStoreSchemaOptions } from './schema-contract'

export interface CloudflareD1WorkflowStoreMigration {
  id: string
  name: string
  order: number
  statements: Array<string>
  sql: string
}

export const cloudflareD1WorkflowStoreSchemaVersion = '0001_signal_inbox'

export function getCloudflareD1WorkflowStoreMigrations(
  options?: CloudflareD1WorkflowStoreSchemaOptions,
): Array<CloudflareD1WorkflowStoreMigration> {
  const statements =
    getCloudflareD1WorkflowStoreInitialSchemaStatements(options)
  const inboxStatements =
    getCloudflareD1WorkflowStoreInboxSchemaStatements(options)

  return [
    {
      id: '0000_workflow_store',
      name: 'Create TanStack Workflow Cloudflare D1 store tables',
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

export function getCloudflareD1WorkflowStoreMigrationSql(
  options?: CloudflareD1WorkflowStoreSchemaOptions,
): string {
  return getCloudflareD1WorkflowStoreMigrations(options)
    .map((migration) => migration.sql)
    .join('\n')
}
