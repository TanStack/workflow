import { describe, expect, it, vi } from 'vitest'
import { trace } from '@opentelemetry/api'
import {
  createWorkflow,
  createWorkflowTelemetry,
  inMemoryRunStore,
  runWorkflow,
} from '../src'
import { collect } from './test-utils'
import type {
  Attributes,
  Context,
  Link,
  Span,
  SpanContext,
  SpanOptions,
  SpanStatus,
  TimeInput,
  Tracer,
} from '@opentelemetry/api'

describe('workflow OpenTelemetry tracing', () => {
  it('does not expose an ambient span when telemetry is disabled', async () => {
    const ambientSpan = new TestSpan('ambient', undefined)
    const activeSpanSpy = vi
      .spyOn(trace, 'getActiveSpan')
      .mockReturnValue(ambientSpan)

    try {
      const telemetry = createWorkflowTelemetry(false, 'test')
      const callbackSpan = await telemetry.startActiveSpan(
        'disabled',
        {},
        async (span) => span,
      )

      expect(callbackSpan).not.toBe(ambientSpan)
      expect(callbackSpan.isRecording()).toBe(false)
    } finally {
      activeSpanSpy.mockRestore()
    }
  })

  it('records fresh step spans without payload or result attributes', async () => {
    const tracer = new TestTracer()
    const workflow = createWorkflow({ id: 'otel-core', version: 'v1' }).handler(
      async (ctx) => {
        const value = await ctx.step(
          'safe-step',
          () => ({ secret: 'do-not-record' }),
          { meta: { publicName: 'safe' } },
        )
        return value
      },
    )

    await collect(
      runWorkflow({
        workflow,
        input: { secret: 'input-secret' },
        runStore: inMemoryRunStore(),
        telemetry: {
          tracer,
          attributes: { 'app.safe': 'yes' },
          mapStepMeta: (meta) => ({ 'app.step_name': String(meta.publicName) }),
        },
      }),
    )

    const stepSpan = tracer.spans.find(
      (span) => span.name === 'tanstack.workflow.step',
    )
    expect(stepSpan).toBeDefined()
    expect(stepSpan?.attributes).toMatchObject({
      'app.safe': 'yes',
      'app.step_name': 'safe',
      'tanstack.workflow.workflow_id': 'otel-core',
      'tanstack.workflow.workflow_version': 'v1',
      'tanstack.workflow.step_id': 'safe-step',
    })
    expect(JSON.stringify(stepSpan?.attributes)).not.toContain('secret')
    expect(stepSpan?.events.map((event) => event.name)).toEqual([
      'workflow.step.attempt.started',
      'workflow.step.attempt.finished',
    ])
  })

  it('records retry attempt events and failed step exceptions', async () => {
    const tracer = new TestTracer()
    const workflow = createWorkflow({ id: 'otel-retry' }).handler(
      async (ctx) => {
        try {
          await ctx.step(
            'flaky',
            () => {
              throw new Error('boom')
            },
            { retry: { maxAttempts: 2, backoff: 'fixed', baseMs: 1 } },
          )
        } catch {
          return { recovered: true }
        }
        return { recovered: false }
      },
    )

    await collect(
      runWorkflow({
        workflow,
        input: {},
        runStore: inMemoryRunStore(),
        telemetry: { tracer },
      }),
    )

    const stepSpan = tracer.spans.find(
      (span) => span.name === 'tanstack.workflow.step',
    )
    expect(stepSpan?.events.map((event) => event.name)).toEqual([
      'workflow.step.attempt.started',
      'workflow.step.attempt.failed',
      'workflow.step.attempt.started',
      'workflow.step.attempt.failed',
    ])
    expect(stepSpan?.status.code).toBe(2)
    expect(stepSpan?.exceptions).toHaveLength(1)
  })
})

class TestTracer implements Tracer {
  spans: Array<TestSpan> = []

  startSpan(name: string, options?: SpanOptions): Span {
    const span = new TestSpan(name, options?.attributes)
    this.spans.push(span)
    return span
  }

  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    optionsOrFn: SpanOptions | F,
    contextOrFn?: Context | F,
    maybeFn?: F,
  ): ReturnType<F> {
    const options = typeof optionsOrFn === 'function' ? undefined : optionsOrFn
    const fn =
      typeof optionsOrFn === 'function'
        ? optionsOrFn
        : typeof contextOrFn === 'function'
          ? contextOrFn
          : maybeFn
    if (!fn) throw new Error('Missing span callback')
    return fn(this.startSpan(name, options)) as ReturnType<F>
  }
}

class TestSpan implements Span {
  attributes: Attributes = {}
  events: Array<{ name: string; attributes?: Attributes }> = []
  exceptions: Array<unknown> = []
  status: SpanStatus = { code: 0 }
  ended = false

  constructor(
    readonly name: string,
    attributes: Attributes | undefined,
  ) {
    if (attributes) this.attributes = { ...attributes }
  }

  spanContext(): SpanContext {
    return {
      traceId: '00000000000000000000000000000001',
      spanId: '0000000000000001',
      traceFlags: 1,
    }
  }

  setAttribute(key: string, value: Attributes[string]): this {
    this.attributes[key] = value
    return this
  }

  setAttributes(attributes: Attributes): this {
    Object.assign(this.attributes, attributes)
    return this
  }

  addEvent(name: string, attributes?: Attributes): this {
    this.events.push({ name, attributes })
    return this
  }

  addLink(_link: Link): this {
    return this
  }

  addLinks(_links: Array<Link>): this {
    return this
  }

  setStatus(status: SpanStatus): this {
    this.status = status
    return this
  }

  updateName(_name: string): this {
    return this
  }

  end(_endTime?: TimeInput): void {
    this.ended = true
  }

  isRecording(): boolean {
    return true
  }

  recordException(exception: unknown): void {
    this.exceptions.push(exception)
  }
}
