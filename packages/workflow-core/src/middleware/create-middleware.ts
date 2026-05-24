import type {
  AssertNonReservedExtension,
  Middleware,
  MiddlewareServerFn,
} from '../types'

export interface CreateMiddlewareBuilder<TCtxIn> {
  /**
   * Provide the server-side middleware function. Receives the
   * current `ctx` and a `next` callback that takes the additional
   * fields to merge into the ctx for downstream middleware and the
   * handler.
   *
   *     const requireUser = createMiddleware().server(async ({ next }) => {
   *       const user = await loadUser()
   *       if (!user) throw new Error('unauthorized')
   *       return next({ context: { user } })
   *     })
   */
  server: <TExtension>(
    fn: MiddlewareServerFn<TCtxIn, AssertNonReservedExtension<TExtension>>,
  ) => Middleware<TCtxIn, AssertNonReservedExtension<TExtension>>
}

/**
 * Build a middleware that extends the workflow ctx. Type-level
 * accumulation makes the extension visible to downstream middleware
 * and the handler.
 *
 *     const traced = createMiddleware().server(async ({ ctx, next }) => {
 *       const trace = startTrace(ctx.runId)
 *       try {
 *         return await next({ context: { trace } })
 *       } finally {
 *         trace.end()
 *       }
 *     })
 *
 * For middleware that should compose on top of an already-extended
 * ctx, type the generic explicitly:
 *
 *     createMiddleware<{ user: User }>().server(async ({ ctx, next }) => {
 *       // ctx.user is typed
 *     })
 */
export function createMiddleware<
  TCtxIn = unknown,
>(): CreateMiddlewareBuilder<TCtxIn> {
  return {
    server(fn) {
      return {
        __kind: 'middleware',
        server: fn,
      }
    },
  }
}
