import { expect, it } from 'vitest'
import { createDurableFulfillmentRuntime } from '../../../examples/durable-recovery/workflow'
import { inMemoryWorkflowExecutionStore } from '../src'

it('fulfills an order with an early payment and a durable shipping retry', async () => {
  const store = inMemoryWorkflowExecutionStore()
  const calls: string[] = []
  const runtime = createDurableFulfillmentRuntime(store, {
    reserve: async (orderId) => {
      calls.push(`reserve ${orderId}`)
    },
    release: async (orderId) => {
      calls.push(`release ${orderId}`)
    },
    ship: async (orderId, paymentId, { attempt }) => {
      calls.push(`ship ${orderId} ${paymentId} ${attempt}`)
      if (attempt === 1) throw new Error('shipping service unavailable')
      return 'shipment-1'
    },
  })
  await store.createRun({
    runId: 'order:123',
    workflowId: 'durable-fulfillment',
    workflowVersion: 'v1',
    input: { orderId: '123' },
    now: Date.now(),
  })
  expect(
    (
      await runtime.deliverSignal({
        runId: 'order:123',
        signalId: 'payment:456',
        name: 'payment',
        payload: { paymentId: '456' },
      })
    ).kind,
  ).toBe('buffered')
  await runtime.sweep()
  expect((await store.loadRun('order:123'))?.status).toBe('paused')
  await runtime.sweep({ now: Date.now() + 2_000 })
  expect((await store.loadRun('order:123'))?.output).toBe('shipment-1')
  expect(calls).toEqual(['reserve 123', 'ship 123 456 1', 'ship 123 456 2'])
})
