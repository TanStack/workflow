import { getCloudflareD1WorkflowStoreSchemaStatements } from './schema-contract'
import type { CloudflareD1WorkflowStoreSchemaOptions } from './schema-contract'

export interface CloudflareD1WorkflowStoreMigration {
  id: string
  name: string
  order: number
  statements: Array<string>
  sql: string
}

export const cloudflareD1WorkflowStoreSchemaVersion = '0000_workflow_store'

export function getCloudflareD1WorkflowStoreMigrations(
  options?: CloudflareD1WorkflowStoreSchemaOptions,
): Array<CloudflareD1WorkflowStoreMigration> {
  const statements = getCloudflareD1WorkflowStoreSchemaStatements(options)

  return [
    {
      id: cloudflareD1WorkflowStoreSchemaVersion,
      name: 'Create TanStack Workflow Cloudflare D1 store tables',
      order: 0,
      statements,
      sql: `${statements.join(';\n\n')};\n`,
    },
  ]
}

export function getCloudflareD1WorkflowStoreMigrationSql(
  options?: CloudflareD1WorkflowStoreSchemaOptions,
): string {
  return getCloudflareD1WorkflowStoreMigrations(options)[0]!.sql
}
