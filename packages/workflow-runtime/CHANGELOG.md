# @tanstack/workflow-runtime

## 0.0.4

### Patch Changes

- [#15](https://github.com/TanStack/workflow/pull/15) [`b928717`](https://github.com/TanStack/workflow/commit/b9287174b44424059895a0ed834b18ce50e0484a) - Add expired-run recovery, automatic run-lease heartbeats, and best-effort live
  event publishing to the workflow runtime.

- [#25](https://github.com/TanStack/workflow/pull/25) [`c6a78fc`](https://github.com/TanStack/workflow/commit/c6a78fc50f2d2aabadc3e4bfb4d989bec2b16f8c) - Bound timer inspections and rotate persisted claims so unavailable workflow versions cannot starve other due timers. Release unused claims on deadlines and errors, and claim D1 batches atomically. Existing SQL stores must apply migration 0001_fair_timer_claims before upgrading the runtime, or run ensureSchema during deployment. Custom stores must implement fair claims and ownership-checked timer lease release.

- [#25](https://github.com/TanStack/workflow/pull/25) [`c6a78fc`](https://github.com/TanStack/workflow/commit/c6a78fc50f2d2aabadc3e4bfb4d989bec2b16f8c) - Reject signal, approval, and timer deliveries for a run whose workflow version
  is not registered, returning `version-mismatch` and leaving the run paused
  instead of consuming the delivery and stranding the run.
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
