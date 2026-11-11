---
'@tanstack/workflow-runtime': patch
'@tanstack/workflow-store-cloudflare-d1': patch
'@tanstack/workflow-store-drizzle-postgres': patch
---

Bound timer inspections and rotate persisted claims so unavailable workflow versions cannot starve other due timers. Release unused claims on deadlines and errors, and claim D1 batches atomically. Existing SQL stores must apply migration 0001_fair_timer_claims before upgrading the runtime, or run ensureSchema during deployment. Custom stores must implement fair claims and ownership-checked timer lease release.
