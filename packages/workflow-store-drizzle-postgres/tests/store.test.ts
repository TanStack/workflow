import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { createDrizzlePostgresWorkflowStore } from '../src'
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
