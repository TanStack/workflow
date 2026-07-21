import { describe, expect, it } from 'vitest'
import { createWorkflow } from '@tanstack/workflow-core'
import { defineWorkflowRuntime, inMemoryWorkflowExecutionStore } from '../src'
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

describe('workflow runtime OpenTelemetry tracing', () => {
  it('records runtime, store, drive, and step spans with safe attributes', async () => {
    const tracer = new TestTracer()
    const store = inMemoryWorkflowExecutionStore()
    const workflow = createWorkflow({
      id: 'otel-runtime',
      version: 'v1',
    }).handler(async (ctx) => {
      await ctx.step('reserve', () => ({ secret: 'never' }))
      return { ok: true }
    })
    const runtime = defineWorkflowRuntime({
      store,
      telemetry: {
        tracer,
        attributes: ({ workflowId }) => ({
          'app.workflow_seen': workflowId ?? 'unknown',
        }),
      },
      workflows: {
        'otel-runtime': {
          load: async () => workflow,
        },
      },
    })

    const result = await runtime.startRun({
      workflowId: 'otel-runtime',
      runId: 'otel-runtime:1',
      input: { secret: 'input' },
      now: 0,
      leaseOwner: 'test-worker',
    })

    expect(result.kind).toBe('completed')
    expect(tracer.spans.map((span) => span.name)).toEqual(
      expect.arrayContaining([
        'tanstack.workflow.start_run',
        'tanstack.workflow.drive_run',
        'tanstack.workflow.store.create_run',
        'tanstack.workflow.store.claim_run',
        'tanstack.workflow.store.append_events',
        'tanstack.workflow.store.release_run_lease',
        'tanstack.workflow.store.load_run',
        'tanstack.workflow.step',
      ]),
    )
    const startSpan = tracer.spans.find(
      (span) => span.name === 'tanstack.workflow.start_run',
    )
    expect(startSpan?.attributes).toMatchObject({
      'tanstack.workflow.workflow_id': 'otel-runtime',
      'tanstack.workflow.workflow_version': 'v1',
      'tanstack.workflow.run_id': 'otel-runtime:1',
      'tanstack.workflow.lease_owner': 'test-worker',
      'tanstack.workflow.result_kind': 'completed',
      'app.workflow_seen': 'otel-runtime',
    })
    expect(
      JSON.stringify(tracer.spans.map((span) => span.attributes)),
    ).not.toContain('secret')
  })

  it('can disable telemetry', async () => {
    const tracer = new TestTracer()
    const workflow = createWorkflow({ id: 'otel-disabled' }).handler(
      async () => ({}),
    )
    const runtime = defineWorkflowRuntime({
      store: inMemoryWorkflowExecutionStore(),
      telemetry: { tracer, enabled: false },
      workflows: {
        'otel-disabled': {
          load: async () => workflow,
        },
      },
    })

    await runtime.startRun({
      workflowId: 'otel-disabled',
      runId: 'otel-disabled:1',
      input: {},
      now: 0,
    })

    expect(tracer.spans).toEqual([])
  })

  it('records signal and sweep spans', async () => {
    const tracer = new TestTracer()
    const store = inMemoryWorkflowExecutionStore()
    const signalWorkflow = createWorkflow({ id: 'signal' }).handler(
      async (ctx) => ctx.waitForEvent('go'),
    )
    const timerWorkflow = createWorkflow({ id: 'timer' }).handler(
      async (ctx) => {
        await ctx.sleepUntil(10)
        return { ok: true }
      },
    )
    const runtime = defineWorkflowRuntime({
      store,
      telemetry: { tracer },
      workflows: {
        signal: { load: async () => signalWorkflow },
        timer: { load: async () => timerWorkflow },
      },
    })

    await runtime.startRun({
      workflowId: 'signal',
      runId: 'signal:1',
      input: {},
      now: 0,
    })
    await runtime.deliverSignal({
      runId: 'signal:1',
      signalId: 'go:1',
      name: 'go',
      payload: { secret: 'payload' },
      now: 1,
    })
    await runtime.startRun({
      workflowId: 'timer',
      runId: 'timer:1',
      input: {},
      now: 0,
    })
    await runtime.sweep({ now: 10, leaseOwner: 'sweep-worker' })

    expect(tracer.spans.map((span) => span.name)).toEqual(
      expect.arrayContaining([
        'tanstack.workflow.deliver_signal',
        'tanstack.workflow.sweep',
        'tanstack.workflow.store.claim_due_timers',
      ]),
    )
    const signalSpan = tracer.spans.find(
      (span) => span.name === 'tanstack.workflow.deliver_signal',
    )
    expect(signalSpan?.attributes).toMatchObject({
      'tanstack.workflow.run_id': 'signal:1',
      'tanstack.workflow.signal_name': 'go',
      'tanstack.workflow.result_kind': 'completed',
    })
    expect(JSON.stringify(signalSpan?.attributes)).not.toContain('payload')
  })

  it('marks store operation failures as span errors and rethrows', async () => {
    const tracer = new TestTracer()
    const store = inMemoryWorkflowExecutionStore()
    const originalClaimRun = store.claimRun
    store.claimRun = async (args) => {
      if (args.runId === 'broken:1') throw new Error('claim failed')
      return await originalClaimRun(args)
    }
    const workflow = createWorkflow({ id: 'broken' }).handler(async () => ({}))
    const runtime = defineWorkflowRuntime({
      store,
      telemetry: { tracer },
      workflows: {
        broken: {
          load: async () => workflow,
        },
      },
    })

    await expect(
      runtime.startRun({
        workflowId: 'broken',
        runId: 'broken:1',
        input: {},
        now: 0,
      }),
    ).rejects.toThrow('claim failed')

    const claimSpan = tracer.spans.find(
      (span) => span.name === 'tanstack.workflow.store.claim_run',
    )
    expect(claimSpan?.status.code).toBe(2)
    expect(claimSpan?.exceptions).toHaveLength(1)
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
