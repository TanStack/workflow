import type { Operation } from './state-diff'
import type { StepKind, WorkflowEvent } from '../types'

/**
 * Helpers that produce typed `WorkflowEvent` chunks for the workflow
 * lifecycle. The engine yields these into the outer event stream.
 */

export function runStartedEvent(args: {
  runId: string
  threadId?: string
}): WorkflowEvent {
  return {
    type: 'RUN_STARTED',
    timestamp: Date.now(),
    runId: args.runId,
    threadId: args.threadId ?? args.runId,
  }
}

export function runFinishedEvent(args: {
  runId: string
  threadId?: string
  output?: unknown
}): WorkflowEvent {
  return {
    type: 'RUN_FINISHED',
    timestamp: Date.now(),
    runId: args.runId,
    threadId: args.threadId ?? args.runId,
    output: args.output,
  }
}

export function runErrorEvent(args: {
  runId: string
  threadId?: string
  message: string
  code?: string
}): WorkflowEvent {
  return {
    type: 'RUN_ERROR',
    timestamp: Date.now(),
    runId: args.runId,
    threadId: args.threadId ?? args.runId,
    message: args.message,
    code: args.code ?? 'error',
  }
}

export function stepStartedEvent(args: {
  stepId: string
  stepName: string
  stepType?: StepKind
}): WorkflowEvent {
  return {
    type: 'STEP_STARTED',
    timestamp: Date.now(),
    stepName: args.stepName,
    stepId: args.stepId,
    stepType: args.stepType,
  }
}

export function stepFinishedEvent(args: {
  stepId: string
  stepName: string
  content?: unknown
}): WorkflowEvent {
  return {
    type: 'STEP_FINISHED',
    timestamp: Date.now(),
    stepName: args.stepName,
    stepId: args.stepId,
    content: args.content,
  }
}

export function stateSnapshotEvent(args: { snapshot: unknown }): WorkflowEvent {
  return {
    type: 'STATE_SNAPSHOT',
    timestamp: Date.now(),
    snapshot: args.snapshot,
  }
}

export function stateDeltaEvent(args: {
  delta: Array<Operation>
}): WorkflowEvent {
  return {
    type: 'STATE_DELTA',
    timestamp: Date.now(),
    delta: args.delta,
  }
}

export function customEvent(args: {
  name: string
  value: Record<string, unknown>
}): WorkflowEvent {
  return {
    type: 'CUSTOM',
    timestamp: Date.now(),
    name: args.name,
    value: args.value,
  }
}

export function approvalRequestedEvent(args: {
  approvalId: string
  title: string
  description?: string
}): WorkflowEvent {
  return customEvent({
    name: 'approval-requested',
    value: {
      approvalId: args.approvalId,
      title: args.title,
      description: args.description,
    },
  })
}
