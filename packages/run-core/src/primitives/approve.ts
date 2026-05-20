import type { ApprovalResult, StepDescriptor, StepGenerator } from '../types'

export interface ApproveOptions {
  title: string
  description?: string
}

/**
 * Yieldable approval primitive.
 *
 *     const decision = yield* approve({ title: 'Publish?' })
 *     if (!decision.approved) return { ok: false }
 *
 * The engine pauses the run, emits an `approval-requested` custom event,
 * closes the event stream, and resumes when the host replies.
 */
export function* approve(
  options: ApproveOptions,
): StepGenerator<ApprovalResult> {
  const descriptor: StepDescriptor = {
    kind: 'approval',
    title: options.title,
    description: options.description,
  }
  // The engine returns ApprovalResult via gen.next(value).
   
  const result = (yield descriptor) as unknown as ApprovalResult
  return result
}
