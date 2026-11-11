---
'@tanstack/workflow-runtime': patch
---

Reject signal, approval, and timer deliveries for a run whose workflow version
is not registered, returning `version-mismatch` and leaving the run paused
instead of consuming the delivery and stranding the run.
