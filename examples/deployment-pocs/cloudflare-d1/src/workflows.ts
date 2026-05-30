import { createWorkflow } from '@tanstack/workflow-core'

export interface FulfillmentInput {
  orderId: string
  amount: number
  readyAt: number
}

export interface PaymentReceivedPayload {
  paymentId: string
  provider: string
}

export interface DigestInput {
  triggeredAt: number
  scheduleId: string
}

export const fulfillmentWorkflow = createWorkflow({
  id: 'd1-fulfillment',
  version: 'poc-v1',
}).handler(async (ctx) => {
  const input = ctx.input as FulfillmentInput

  const reservation = await ctx.step('reserve-inventory', (step) => ({
    reservationId: `res_${input.orderId}`,
    idempotencyKey: step.id,
    reservedAt: Date.now(),
  }))

  const firstSeenAt = await ctx.now()
  if (input.readyAt > firstSeenAt) {
    await ctx.sleepUntil(input.readyAt)
  }

  const payment = await ctx.waitForEvent<PaymentReceivedPayload>(
    'payment-received',
    {
      meta: {
        orderId: input.orderId,
        reservationId: reservation.reservationId,
      },
    },
  )

  const shipment = await ctx.step('ship-order', (step) => ({
    shipmentId: `ship_${input.orderId}`,
    idempotencyKey: step.id,
    shippedAt: Date.now(),
  }))

  return {
    orderId: input.orderId,
    amount: input.amount,
    reservation,
    payment,
    shipment,
  }
})

export const digestWorkflow = createWorkflow({
  id: 'd1-digest',
  version: 'poc-v1',
}).handler(async (ctx) => {
  const input = ctx.input as DigestInput

  const digest = await ctx.step('generate-digest', (step) => ({
    digestId: `digest_${input.scheduleId}_${input.triggeredAt}`,
    idempotencyKey: step.id,
    generatedAt: Date.now(),
  }))

  await ctx.step('publish-digest', (step) => ({
    digestId: digest.digestId,
    idempotencyKey: step.id,
    publishedAt: Date.now(),
  }))

  return digest
})
