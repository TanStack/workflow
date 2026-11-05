# @tanstack/workflow-runtime

## 0.0.4

### Patch Changes

- Add expired-run recovery, automatic run-lease heartbeats, and best-effort live ([#15](https://github.com/TanStack/workflow/pull/15))
  event publishing to the workflow runtime.
- Updated dependencies [[`b928717`](https://github.com/TanStack/workflow/commit/b9287174b44424059895a0ed834b18ce50e0484a)]:
  - @tanstack/workflow-core@0.0.5

## 0.0.3

### Patch Changes

- Add runtime deadlines, automatic cooperative yielding at durable boundaries, ([#13](https://github.com/TanStack/workflow/pull/13))
  and deadline helpers under `ctx.runtime`. Timer wake identities now include the
  durable operation ID so sequential waits at the same timestamp resume safely.

- Add first-class OpenTelemetry tracing for workflow runtime operations, durable store calls, and fresh step execution. ([#13](https://github.com/TanStack/workflow/pull/13))

- Updated dependencies [[`87340c8`](https://github.com/TanStack/workflow/commit/87340c85cdf4fd1fec38b405db37fa97cc6388fd), [`87340c8`](https://github.com/TanStack/workflow/commit/87340c85cdf4fd1fec38b405db37fa97cc6388fd)]:
  - @tanstack/workflow-core@0.0.4

## 0.0.1

### Patch Changes

- Add the workflow runtime, durable execution store contract, Drizzle/Postgres store, Vercel and Netlify host adapters, deployment POCs, and production docs.

- Updated dependencies []:
  - @tanstack/workflow-core@0.0.3
