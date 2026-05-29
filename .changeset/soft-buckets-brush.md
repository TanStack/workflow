---
'@tanstack/workflow-store-drizzle-postgres': patch
'@tanstack/workflow-netlify': patch
'@tanstack/workflow-vercel': patch
---

Fix due schedule claiming so an already-started older bucket cannot starve later due schedules, and keep host adapter exports focused on runtime handlers instead of static platform config helpers.
