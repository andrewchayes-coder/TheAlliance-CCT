---
name: Source audit scope
description: Managed runtime snapshots can retain removed text and produce misleading recursive source-search matches.
---

Treat managed binary runtime snapshots as persisted history, not application source. They can retain inspected document content and callback input after the corresponding project text has been removed. Do not delete managed platform state merely to satisfy a source audit.

**Why:** A recursive retired-access audit found matches only in Replit's binary durable-runtime snapshots after the application and documentation text were clean.

**How to apply:** Distinguish text-file matches from binary history. Scope source audits to application/deployment text, exclude dependencies and managed state, and report any remaining history-only matches honestly.
