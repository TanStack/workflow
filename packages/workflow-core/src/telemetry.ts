import { INVALID_SPAN_CONTEXT, SpanStatusCode, trace } from '@opentelemetry/api'
import type { Attributes, Span, Tracer } from '@opentelemetry/api'
import type { WorkflowMetadata } from './types'

const DEFAULT_SPAN_NAME_PREFIX = 'tanstack.workflow'

export interface WorkflowTelemetrySpanContext {
  workflowId?: string
  workflowVersion?: string
  runId?: string
  operation?: string
  resultKind?: string
  stepId?: string
  signalName?: string
  scheduleId?: string
  bucketId?: string
  leaseOwner?: string
  eventCount?: number
  eventsTruncated?: boolean
}

export interface WorkflowTelemetryStepMetaContext {
  workflowId?: string
  workflowVersion?: string
  runId: string
  stepId: string
}

export interface WorkflowTelemetryOptions {
  enabled?: boolean
  tracer?: Tracer
  spanNamePrefix?: string
  attributes?:
    | Attributes
    | ((ctx: WorkflowTelemetrySpanContext) => Attributes | undefined)
  recordExceptions?: boolean
  mapStepMeta?: (
    meta: WorkflowMetadata,
    ctx: WorkflowTelemetryStepMetaContext,
  ) => Attributes | undefined
}

export interface WorkflowTelemetry {
  enabled: boolean
  spanNamePrefix: string
  startActiveSpan: <T>(
    operation: string,
    spanContext: WorkflowTelemetrySpanContext,
    fn: (span: Span) => T | Promise<T>,
    attributes?: Attributes,
  ) => Promise<T>
  addActiveSpanEvent: (name: string, attributes?: Attributes) => void
  mapStepMeta: (
    meta: WorkflowMetadata | undefined,
    ctx: WorkflowTelemetryStepMetaContext,
  ) => Attributes | undefined
}

export function createWorkflowTelemetry(
  options: false | WorkflowTelemetryOptions | undefined,
  tracerName: string,
): WorkflowTelemetry {
  if (options === false || options?.enabled === false) {
    return disabledWorkflowTelemetry
  }

  const tracer = options?.tracer ?? trace.getTracer(tracerName)
  const spanNamePrefix = options?.spanNamePrefix ?? DEFAULT_SPAN_NAME_PREFIX
  const recordExceptions = options?.recordExceptions ?? true

  return {
    enabled: true,
    spanNamePrefix,
    async startActiveSpan(operation, spanContext, fn, attributes) {
      return await tracer.startActiveSpan(
        `${spanNamePrefix}.${operation}`,
        {
          attributes: {
            ...resolveSharedAttributes(options?.attributes, spanContext),
            ...safeSpanAttributes(spanContext),
            ...attributes,
            'tanstack.workflow.operation': operation,
          },
        },
        async (span) => {
          try {
            const result = await fn(span)
            span.setStatus({ code: SpanStatusCode.OK })
            return result
          } catch (error) {
            markSpanError(span, error, recordExceptions)
            throw error
          } finally {
            span.end()
          }
        },
      )
    },
    addActiveSpanEvent(name, attributes) {
      trace.getActiveSpan()?.addEvent(name, attributes)
    },
    mapStepMeta(meta, ctx) {
      if (!meta || !options?.mapStepMeta) return undefined
      return options.mapStepMeta(meta, ctx)
    },
  }
}

function markSpanError(span: Span, error: unknown, recordException: boolean) {
  const serialized = serializeTelemetryError(error)
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: serialized.message,
  })
  span.setAttribute('error.type', serialized.name)
  span.setAttribute('exception.type', serialized.name)
  span.setAttribute('exception.message', serialized.message)
  if (recordException) {
    if (error instanceof Error) {
      span.recordException(error)
    } else {
      span.recordException(serialized)
    }
  }
}

function resolveSharedAttributes(
  attributes: WorkflowTelemetryOptions['attributes'],
  spanContext: WorkflowTelemetrySpanContext,
) {
  if (!attributes) return undefined
  if (typeof attributes === 'function') return attributes(spanContext)
  return attributes
}

function safeSpanAttributes(ctx: WorkflowTelemetrySpanContext): Attributes {
  return compactAttributes({
    'tanstack.workflow.workflow_id': ctx.workflowId,
    'tanstack.workflow.workflow_version': ctx.workflowVersion,
    'tanstack.workflow.run_id': ctx.runId,
    'tanstack.workflow.result_kind': ctx.resultKind,
    'tanstack.workflow.step_id': ctx.stepId,
    'tanstack.workflow.signal_name': ctx.signalName,
    'tanstack.workflow.schedule_id': ctx.scheduleId,
    'tanstack.workflow.bucket_id': ctx.bucketId,
    'tanstack.workflow.lease_owner': ctx.leaseOwner,
    'tanstack.workflow.event_count': ctx.eventCount,
    'tanstack.workflow.events_truncated': ctx.eventsTruncated,
  })
}

function compactAttributes(attributes: Attributes): Attributes {
  return Object.fromEntries(
    Object.entries(attributes).filter(([, value]) => value !== undefined),
  )
}

function serializeTelemetryError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    }
  }

  return {
    name: typeof error,
    message: String(error),
  }
}

const disabledWorkflowTelemetry: WorkflowTelemetry = {
  enabled: false,
  spanNamePrefix: DEFAULT_SPAN_NAME_PREFIX,
  async startActiveSpan(_operation, _spanContext, fn) {
    return await fn(trace.wrapSpanContext(INVALID_SPAN_CONTEXT))
  },
  addActiveSpanEvent() {},
  mapStepMeta() {
    return undefined
  },
}
