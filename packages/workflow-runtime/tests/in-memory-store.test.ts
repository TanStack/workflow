import { inMemoryWorkflowExecutionStore } from '../src'
import { runWorkflowExecutionStoreContractTests } from './contracts/workflow-execution-store.contract'

runWorkflowExecutionStoreContractTests({
  durability: true,
  name: 'in-memory',
  createStore: () => inMemoryWorkflowExecutionStore(),
})
