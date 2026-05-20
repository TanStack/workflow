import type {
  InferSchema,
  SchemaInput,
  StepDescriptor,
  StepRetryOptions,
  WorkflowDefinition,
  WorkflowRunArgs,
} from '../types'

export interface DefineWorkflowConfig<
  TInputSchema extends SchemaInput | undefined,
  TOutputSchema extends SchemaInput | undefined,
  TStateSchema extends SchemaInput | undefined,
> {
  name: string
  description?: string
  /** Caller-supplied version identifier — e.g. 'v1', '2026-05-15'.
   *  Used with `selectWorkflowVersion` for cross-version routing. */
  version?: string
  /** Migration patch names. Pairs with `yield* patched(name)` calls
   *  in user code. Declaring this switches the workflow to a lighter
   *  fingerprint that tolerates code-body changes. */
  patches?: ReadonlyArray<string>
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
  /**
   * Default retry policy applied to every `step()` call in this
   * workflow that doesn't carry its own `{ retry }` option. Useful for
   * coarse-grained policies like "retry transient errors up to 3 times
   * with exponential backoff" without repeating it at every site.
   */
  defaultStepRetry?: StepRetryOptions
  run: (
    args: WorkflowRunArgs<
      TInputSchema extends SchemaInput ? InferSchema<TInputSchema> : unknown,
      TStateSchema extends SchemaInput
        ? InferSchema<TStateSchema>
        : Record<string, unknown>
    >,
  ) => AsyncGenerator<
    StepDescriptor,
    TOutputSchema extends SchemaInput ? InferSchema<TOutputSchema> : unknown,
    unknown
  >
}

export function defineWorkflow<
  TInputSchema extends SchemaInput | undefined = undefined,
  TOutputSchema extends SchemaInput | undefined = undefined,
  TStateSchema extends SchemaInput | undefined = undefined,
>(
  config: DefineWorkflowConfig<TInputSchema, TOutputSchema, TStateSchema>,
): WorkflowDefinition<TInputSchema, TOutputSchema, TStateSchema> {
  return {
    __kind: 'workflow',
    name: config.name,
    description: config.description,
    version: config.version,
    patches: config.patches,
    inputSchema: config.input,
    outputSchema: config.output,
    stateSchema: config.state,
    initialize: config.initialize,
    defaultStepRetry: config.defaultStepRetry,
    run: config.run,
  }
}
