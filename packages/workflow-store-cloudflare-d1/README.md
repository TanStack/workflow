# @tanstack/workflow-store-cloudflare-d1

Experimental Cloudflare D1 durable execution store for TanStack Workflow.

This adapter implements the `WorkflowExecutionStore` contract from
`@tanstack/workflow-runtime` using a Cloudflare D1 binding.

## Usage

```bash
pnpm add @tanstack/workflow-store-cloudflare-d1
```

```ts
import { createCloudflareD1WorkflowStore } from '@tanstack/workflow-store-cloudflare-d1'

export interface Env {
  WORKFLOW_DB: D1Database
}

export default {
  async scheduled(_event, env) {
    const store = createCloudflareD1WorkflowStore({ db: env.WORKFLOW_DB })
    // pass store to defineWorkflowRuntime(...)
  },
}
```

Apply the package-owned D1 migration during setup/deploy:

```bash
wrangler d1 migrations apply WORKFLOW_DB
```

The SQL artifact lives at:

```txt
node_modules/@tanstack/workflow-store-cloudflare-d1/migrations/0000_workflow_store.sql
```

`store.ensureSchema()` remains available for tests, local demos, and explicit
admin bootstrap scripts. Production deploys should prefer Cloudflare D1
migrations so schema changes are reviewed and repeatable.
