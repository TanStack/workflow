# @tanstack/workflow-store-cloudflare-d1

## 0.0.5

### Patch Changes

- [#25](https://github.com/TanStack/workflow/pull/25) [`c6a78fc`](https://github.com/TanStack/workflow/commit/c6a78fc50f2d2aabadc3e4bfb4d989bec2b16f8c) - Bound timer inspections and rotate persisted claims so unavailable workflow versions cannot starve other due timers. Release unused claims on deadlines and errors, and claim D1 batches atomically. Existing SQL stores must apply migration 0001_fair_timer_claims before upgrading the runtime, or run ensureSchema during deployment. Custom stores must implement fair claims and ownership-checked timer lease release.

- Updated dependencies [[`b928717`](https://github.com/TanStack/workflow/commit/b9287174b44424059895a0ed834b18ce50e0484a), [`c6a78fc`](https://github.com/TanStack/workflow/commit/c6a78fc50f2d2aabadc3e4bfb4d989bec2b16f8c), [`c6a78fc`](https://github.com/TanStack/workflow/commit/c6a78fc50f2d2aabadc3e4bfb4d989bec2b16f8c)]:
  - @tanstack/workflow-core@0.0.5
  - @tanstack/workflow-runtime@0.0.4

## 0.0.4

### Patch Changes

- Updated dependencies [[`87340c8`](https://github.com/TanStack/workflow/commit/87340c85cdf4fd1fec38b405db37fa97cc6388fd), [`87340c8`](https://github.com/TanStack/workflow/commit/87340c85cdf4fd1fec38b405db37fa97cc6388fd)]:
  - @tanstack/workflow-core@0.0.4
  - @tanstack/workflow-runtime@0.0.3

## 0.0.2

### Patch Changes

- Add a Cloudflare D1 durable Workflow store adapter with package-owned D1 migrations, schema migration tracking, migration helper exports, and runtime store support for Cloudflare Workers.
