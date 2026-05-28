import { inMemoryWorkflowExecutionStore } from '../src'
import { runWorkflowExecutionStoreContractTests } from './contracts/workflow-execution-store.contract'

runWorkflowExecutionStoreContractTests({
  name: 'in-memory',
  createStore: () => inMemoryWorkflowExecutionStore(),
})
