import {
  getCloudflareD1TimerFairnessStatements,
  getCloudflareD1WorkflowStoreSchemaStatements,
} from './schema-contract'
import type { CloudflareD1WorkflowStoreSchemaOptions } from './schema-contract'

export interface CloudflareD1WorkflowStoreMigration {
  id: string
  name: string
  order: number
  statements: Array<string>
  sql: string
}

export const cloudflareD1WorkflowStoreSchemaVersion = '0001_fair_timer_claims'

export function getCloudflareD1WorkflowStoreMigrations(
  options?: CloudflareD1WorkflowStoreSchemaOptions,
): Array<CloudflareD1WorkflowStoreMigration> {
  const statements = getCloudflareD1WorkflowStoreSchemaStatements(options)

  return [
    {
      id: '0000_workflow_store',
      name: 'Create TanStack Workflow Cloudflare D1 store tables',
      order: 0,
      statements,
      sql: `${statements.join(';\n\n')};\n`,
    },
    {
      id: '0001_fair_timer_claims',
      name: 'Fair timer claims',
      order: 1,
      statements: getCloudflareD1TimerFairnessStatements(options),
      sql: `${getCloudflareD1TimerFairnessStatements(options).join(';\n\n')};\n`,
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
