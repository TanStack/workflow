# Durable fulfillment

`createDurableFulfillmentRuntime(store, operations)` combines early payment
signals, durable shipping retries, and inventory compensation. Supply a D1 or
Postgres execution store and your inventory/shipping APIs. Apply both store
migrations first. Use `inMemoryWorkflowExecutionStore()` only for local tests.

Start an order and deliver a payment, in either order after the run exists:

```ts
const runtime = createDurableFulfillmentRuntime(store, operations)

await runtime.startRun({
  workflowId: 'durable-fulfillment',
  runId: 'order:123',
  input: { orderId: '123' },
})

await runtime.deliverSignal({
  runId: 'order:123',
  signalId: 'payment:456',
  name: 'payment',
  payload: { paymentId: '456' },
})
```

Schedule `runtime.sweep()` with your host scheduler. A shipping failure pauses
until the persisted retry deadline. Exhausting shipping retries runs inventory
release, which can also retry across invocations.

Implement every operation with `step.id` as its external idempotency key.
Inventory release must tolerate a missing or already released reservation.
A crash can repeat an external request, including an undo request.

The [recovery guide](../../docs/guide/durable-recovery.md) covers ordering,
retention, upgrade steps, and compensation limits. The runtime test suite
exercises this example with an early payment and a retry across sweeps.
