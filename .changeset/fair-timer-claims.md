---
'@tanstack/workflow-runtime': patch
'@tanstack/workflow-store-cloudflare-d1': patch
'@tanstack/workflow-store-drizzle-postgres': patch
---

Prevent unavailable workflow versions from starving other due timers, and release unused timer claims when a sweep stops or fails. Custom execution stores must implement cursor-based timer claims and ownership-checked timer lease release.
