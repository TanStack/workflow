import { createWorkflow } from '@tanstack/workflow-core'
import { defineWorkflowRuntime } from '@tanstack/workflow-runtime'
import type { StepContext } from '@tanstack/workflow-core'
import type { WorkflowExecutionStore } from '@tanstack/workflow-runtime'

export interface FulfillmentOperations {
  reserve: (orderId: string, step: StepContext) => Promise<void>
  release: (orderId: string, step: StepContext) => Promise<void>
  ship: (
    orderId: string,
    paymentId: string,
    step: StepContext,
  ) => Promise<string>
}

// Each operation must use step.id as its external idempotency key. Release
// must also succeed when there is no reservation or it was already released.
export function createDurableFulfillmentRuntime(
  store: WorkflowExecutionStore,
  operations: FulfillmentOperations,
) {
  const workflow = createWorkflow({
    id: 'durable-fulfillment',
    version: 'v1',
  }).handler(async (ctx) => {
    const { orderId } = ctx.input as { orderId: string }
    await ctx.compensate(
      'release-inventory',
      (step) => operations.release(orderId, step),
      { retry: { maxAttempts: 3, baseMs: 1_000 } },
    )
    await ctx.step('reserve-inventory', (step) =>
      operations.reserve(orderId, step),
    )
    const payment = await ctx.waitForEvent<{ paymentId: string }>('payment', {
      id: 'payment-webhook',
    })
    return ctx.step(
      'ship-order',
      (step) => operations.ship(orderId, payment.paymentId, step),
      { retry: { durable: true, maxAttempts: 3, baseMs: 1_000 } },
    )
  })

  return defineWorkflowRuntime({
    store,
    bufferSignals: true,
    workflows: { 'durable-fulfillment': { load: async () => workflow } },
  })
}
