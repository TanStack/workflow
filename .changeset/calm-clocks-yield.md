---
'@tanstack/workflow-core': patch
'@tanstack/workflow-runtime': patch
---

Add runtime deadlines, automatic cooperative yielding at durable boundaries,
and deadline helpers under `ctx.runtime`. Timer wake identities now include the
durable operation ID so sequential waits at the same timestamp resume safely.
