import type {
  AnyMiddleware,
  AnyWorkflowDefinition,
  Ctx,
  InferSchema,
  Middleware,
  ReservedCtxFields,
  SchemaInput,
  StepRetryOptions,
  WorkflowDefinition,
} from '../types'

// ============================================================
// Type-level extension accumulation
// ============================================================

/**
 * Convert a union to an intersection. Used by `AccumulateExtensions`
 * to combine every middleware's added fields into one ctx shape.
 */
type UnionToIntersection<TUnion> = (
  TUnion extends unknown ? (k: TUnion) => void : never
) extends (k: infer TIntersection) => void
  ? TIntersection
  : never

/**
 * Walk an array of middlewares and intersect every extension type
 * they add to the ctx. Works for both tuple and plain-array
 * inference at the `.middleware([...])` call site.
 */
export type AccumulateExtensions<
  TMiddlewares extends ReadonlyArray<AnyMiddleware>,
> = UnionToIntersection<
  TMiddlewares[number] extends Middleware<any, infer TExtension>
    ? TExtension
    : never
>

/**
 * Compile-time guard that a middleware's added fields don't shadow
 * the built-in ctx surface. Resolves to `Middleware<TCtxIn, TExt>`
 * when the extension is safe, or to a TS error type when not.
 */
export type AssertNonReservedExtension<TExt> = keyof TExt &
  ReservedCtxFields extends never
  ? TExt
  : `Middleware extension may not shadow reserved ctx field: ${keyof TExt &
      ReservedCtxFields & string}`

// ============================================================
// Public configuration shape
// ============================================================

export interface CreateWorkflowConfig<
  TInputSchema extends SchemaInput | undefined,
  TOutputSchema extends SchemaInput | undefined,
  TStateSchema extends SchemaInput | undefined,
> {
  id: string
  description?: string
  /** Caller-supplied version identifier (e.g. 'v1', '2026-05-15').
   *  Used with `selectWorkflowVersion` for cross-version routing. */
  version?: string
  input?: TInputSchema
  output?: TOutputSchema
  state?: TStateSchema
  initialize?: (args: {
    input: TInputSchema extends SchemaInput
      ? InferSchema<TInputSchema>
      : unknown
  }) => TStateSchema extends SchemaInput
    ? Partial<InferSchema<TStateSchema>>
    : Record<string, unknown>
  /** Default retry policy applied to every `ctx.step()` call that
   *  doesn't carry its own `{ retry }` option. */
  defaultStepRetry?: StepRetryOptions
}

// ============================================================
// Builder types — chain-style accumulation
// ============================================================

type InferInput<T extends SchemaInput | undefined> = T extends SchemaInput
  ? InferSchema<T>
  : unknown

type InferState<T extends SchemaInput | undefined> = T extends SchemaInput
  ? InferSchema<T>
  : Record<string, unknown>

type InferOutput<T extends SchemaInput | undefined> = T extends SchemaInput
  ? InferSchema<T>
  : unknown

export interface WorkflowBuilder<
  TInputSchema extends SchemaInput | undefined,
  TOutputSchema extends SchemaInput | undefined,
  TStateSchema extends SchemaInput | undefined,
  TCtxExt = unknown,
> {
  /**
   * Register middlewares that extend the ctx for the handler. Each
   * middleware's added fields are intersected into the ctx type.
   */
  middleware: <const TMiddlewares extends ReadonlyArray<AnyMiddleware>>(
    middlewares: TMiddlewares,
  ) => WorkflowBuilder<
    TInputSchema,
    TOutputSchema,
    TStateSchema,
    TCtxExt & AccumulateExtensions<TMiddlewares>
  >

  /**
   * Register prior workflow versions that may still have in-flight
   * runs. Resume calls for a run started under one of these versions
   * route to that version's handler.
   */
  previousVersions: (
    versions: ReadonlyArray<AnyWorkflowDefinition>,
  ) => WorkflowBuilder<TInputSchema, TOutputSchema, TStateSchema, TCtxExt>

  /**
   * Finalize the workflow with its handler. The handler receives the
   * fully-typed ctx — input, state, durable primitives, plus every
   * field added by registered middleware.
   */
  handler: (
    fn: (
      ctx: Ctx<InferInput<TInputSchema>, InferState<TStateSchema>, TCtxExt>,
    ) => Promise<InferOutput<TOutputSchema>>,
  ) => WorkflowDefinition<
    InferInput<TInputSchema>,
    InferOutput<TOutputSchema>,
    InferState<TStateSchema>
  >
}

// ============================================================
// Implementation
// ============================================================

interface InternalState {
  config: CreateWorkflowConfig<any, any, any>
  middlewares: ReadonlyArray<AnyMiddleware>
  previous: ReadonlyArray<AnyWorkflowDefinition>
}

function buildBuilder(state: InternalState): WorkflowBuilder<any, any, any, any> {
  return {
    middleware(middlewares) {
      return buildBuilder({
        ...state,
        middlewares: [...state.middlewares, ...middlewares],
      })
    },
    previousVersions(versions) {
      return buildBuilder({ ...state, previous: versions })
    },
    handler(fn) {
      const def: AnyWorkflowDefinition = {
        __kind: 'workflow',
        id: state.config.id,
        description: state.config.description,
        version: state.config.version,
        previousVersions: state.previous,
        inputSchema: state.config.input,
        outputSchema: state.config.output,
        stateSchema: state.config.state,
        initialize: state.config.initialize,
        defaultStepRetry: state.config.defaultStepRetry,
        middlewares: state.middlewares,
        handler: fn,
      }
      return def
    },
  }
}

/**
 * Define a workflow. Returns a builder chain:
 *
 *     export const onboard = createWorkflow({
 *       id: 'onboard',
 *       input: z.object({ userId: z.string() }),
 *     })
 *       .middleware([requireUser, traced])
 *       .handler(async (ctx) => {
 *         const profile = await ctx.step('load', () => loadProfile(ctx.user.id))
 *         await ctx.sleep(60_000)
 *         const decision = await ctx.approve({ title: 'Continue?' })
 *         return { ok: decision.approved }
 *       })
 *
 * The handler's `ctx` argument carries everything: input, state,
 * durable primitives (`step`, `sleep`, `waitForEvent`, ...), and
 * any fields added by registered middleware. Helpers should accept
 * a typed `Ctx<...>` argument to compose cleanly.
 */
export function createWorkflow<
  TInputSchema extends SchemaInput | undefined = undefined,
  TOutputSchema extends SchemaInput | undefined = undefined,
  TStateSchema extends SchemaInput | undefined = undefined,
>(
  config: CreateWorkflowConfig<TInputSchema, TOutputSchema, TStateSchema>,
): WorkflowBuilder<TInputSchema, TOutputSchema, TStateSchema> {
  return buildBuilder({ config, middlewares: [], previous: [] })
}
