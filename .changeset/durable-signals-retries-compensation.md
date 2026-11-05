---
'@tanstack/workflow-core': minor
'@tanstack/workflow-runtime': minor
'@tanstack/workflow-store-cloudflare-d1': minor
'@tanstack/workflow-store-drizzle-postgres': minor
---

Add opt-in durable signal buffering, persisted automatic step retries, and
explicit compensation handlers with reverse ordering and recoverable progress.
Fence runtime persistence writes with per-drive leases, recover missing timer
scheduling, and acknowledge timers only after their resolution is durable.

Apply the additive `0001_signal_inbox.sql` migration before deploying the updated
D1 or Postgres adapter. Existing histories and default retry/signal behavior stay
compatible. New inbox and timer-acknowledgement methods are optional for custom
adapters. See the durable recovery guide for rollout, retention, and external
idempotency responsibilities.
