import { runWorkflow } from './run-workflow'
import type {
  AnyWorkflowDefinition,
  RunStore,
  SignalDelivery,
  WorkflowEvent,
} from '../types'

export interface WebhookPayload {
  runId: string
  signalDelivery?: SignalDelivery
  approval?: {
    approvalId: string
    approved: boolean
    feedback?: string
  }
}

export interface HandleWebhookOptions {
  workflow: AnyWorkflowDefinition
  runStore: RunStore
  /** Parsed webhook payload (typically built from the HTTP request
   *  body via `parseWorkflowRequest`). */
  payload: WebhookPayload
  /** Hook called for every event the engine appends, before the
   *  webhook handler returns. */
  publish?: (runId: string, event: WorkflowEvent) => void | Promise<void>
}

/**
 * Drive one webhook-triggered invocation of a workflow to its next
 * pause point (or completion).
 *
 * Intended for Durable-Streams-style execution where the workflow
 * lives as a stateless HTTP handler that the streams server POSTs to
 * when external events arrive. Reads the run's history from the
 * `runStore`, replays user code, advances past the seed delivery,
 * pauses at the next awaitable, returns.
 *
 * Returns the list of events appended during this invocation —
 * useful for the caller to forward as the HTTP response body if the
 * streams server wants confirmation of the new state.
 */
export async function handleWorkflowWebhook(
  options: HandleWebhookOptions,
): Promise<ReadonlyArray<WorkflowEvent>> {
  const { workflow, runStore, payload, publish } = options

  const events: Array<WorkflowEvent> = []

  const iter = runWorkflow({
    workflow,
    runStore,
    runId: payload.runId,
    signalDelivery: payload.signalDelivery,
    approval: payload.approval
      ? {
          approvalId: payload.approval.approvalId,
          approved: payload.approval.approved,
          feedback: payload.approval.feedback,
        }
      : undefined,
    publish,
  })
  for await (const event of iter) events.push(event)

  return events
}
