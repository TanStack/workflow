import { createWorkflow } from './define-workflow'
import type {
  AccumulateExtensions,
  CreateWorkflowConfig,
  WorkflowBuilder,
} from './define-workflow'
import type { AnyMiddleware, SchemaInput, StepRetryOptions } from '../types'

// ============================================================
// Public configuration shape
// ============================================================

/**
 * Defaults a factory pre-sets on every workflow it produces.
 * Per-workflow config wins when both are present.
 */
export interface CreateWorkflowFactoryConfig {
  /** Default retry policy applied to every `ctx.step()` call that
   *  doesn't carry its own `{ retry }` option. */
  defaultStepRetry?: StepRetryOptions
}

// ============================================================
// Builder type — callable hybrid with chain methods
// ============================================================

/**
 * A workflow factory. Calling it returns a `WorkflowBuilder` with
 * the factory's middlewares pre-applied and config defaults merged.
 * Chain `.middleware([...])` to layer in shared middleware;
 * `.extend()` to fork a child factory without mutating the parent.
 */
export interface WorkflowFactoryBuilder<TCtxExt = unknown> {
  /**
   * Append middlewares to the factory. They run *before* any
   * middleware registered on the produced workflow, in declaration
   * order, then the workflow's own middlewares, then the handler.
   */
  middleware: <const TMiddlewares extends ReadonlyArray<AnyMiddleware>>(
    middlewares: TMiddlewares,
  ) => WorkflowFactoryBuilder<TCtxExt & AccumulateExtensions<TMiddlewares>>

  /**
   * Fork a child factory with the same middlewares + defaults.
   * Pass overrides to shallow-merge new defaults onto the child.
   * The parent is not mutated.
   */
  extend: (
    overrides?: CreateWorkflowFactoryConfig,
  ) => WorkflowFactoryBuilder<TCtxExt>;

  /**
   * Produce a workflow builder with the factory's state applied.
   * The returned builder still supports `.middleware([...])` for
   * per-workflow middlewares whose ctx extensions are appended to
   * the factory's.
   */
  <
    TInputSchema extends SchemaInput | undefined = undefined,
    TOutputSchema extends SchemaInput | undefined = undefined,
    TStateSchema extends SchemaInput | undefined = undefined,
  >(
    config: CreateWorkflowConfig<TInputSchema, TOutputSchema, TStateSchema>,
  ): WorkflowBuilder<TInputSchema, TOutputSchema, TStateSchema, TCtxExt>
}

// ============================================================
// Implementation
// ============================================================

interface InternalFactoryState {
  middlewares: ReadonlyArray<AnyMiddleware>
  defaults: CreateWorkflowFactoryConfig
}

function buildFactory(
  state: InternalFactoryState,
): WorkflowFactoryBuilder<any> {
  const factory = ((config: CreateWorkflowConfig<any, any, any>) => {
    const merged: CreateWorkflowConfig<any, any, any> = {
      ...config,
      defaultStepRetry:
        config.defaultStepRetry ?? state.defaults.defaultStepRetry,
    }
    const base = createWorkflow(merged)
    return state.middlewares.length > 0
      ? base.middleware(state.middlewares)
      : base
  }) as WorkflowFactoryBuilder<any>

  factory.middleware = ((middlewares: ReadonlyArray<AnyMiddleware>) =>
    buildFactory({
      ...state,
      middlewares: [...state.middlewares, ...middlewares],
    })) as WorkflowFactoryBuilder<any>['middleware']

  factory.extend = (overrides) =>
    buildFactory({
      middlewares: [...state.middlewares],
      defaults: { ...state.defaults, ...overrides },
    })

  return factory
}

/**
 * Build a workflow factory. Use it to pin shared middleware and
 * defaults across a family of workflows:
 *
 *     export const appWorkflow = createWorkflowFactory({
 *       defaultStepRetry: { maxAttempts: 3 },
 *     }).middleware([traced, requireUser])
 *
 *     export const onboard = appWorkflow({ id: 'onboard' })
 *       .middleware([requireEmailVerified])  // appended after factory mws
 *       .handler(async (ctx) => {
 *         ctx.trace; ctx.user; ctx.emailVerified  // all visible
 *       })
 *
 * Factories compose. Derive a specialized child without mutating
 * the parent — `.extend()` accepts default overrides:
 *
 *     export const paidWorkflow = appWorkflow
 *       .extend({ defaultStepRetry: { maxAttempts: 5 } })
 *       .middleware([requirePro])
 */
export function createWorkflowFactory(
  config: CreateWorkflowFactoryConfig = {},
): WorkflowFactoryBuilder<unknown> {
  return buildFactory({ middlewares: [], defaults: config })
}
