# @tanstack/workflow-runtime

Experimental runtime contracts for TanStack Workflow.

This package is the staging area for durable execution store, schedule, timer,
signal, lease, and host-adapter contracts. It is intentionally separate from
`@tanstack/workflow-core`, which remains the small replay engine.

See the main docs:

- [Guide](../../docs/guide/index.md)
- [Runtime model](../../docs/guide/runtime-model.md)
- [Runtime API](../../docs/api/runtime.md)

## Store adapter contract tests

Storage adapters should wire their implementation into
`tests/contracts/workflow-execution-store.contract.ts`. The contract suite covers
the behavior every durable store must preserve: idempotent run creation,
compare-and-swap event appends, run leases, stale run claiming, timers, signal
and approval delivery, schedules, timelines, and integration with the runtime
driver.
