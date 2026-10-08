---
name: Coverage notification timing
description: Coverage alerts require actual reductions; digest scheduling must survive Pacific DST and sleeping web runtimes.
---

Immediate coverage notifications should report actual lost coverage, not every pre-existing under-capacity slot. Compare before/after occurrences and combine all affected dates for a release into one message per administrator.

**Why:** standing assignments reserve future seats, and an absence or removal may not change a particular occurrence (for example, when it was already skipped or closed). Reporting all existing gaps would create misleading repeated alerts.

**How to apply:** preserve the previous assignment state in audited release events and use the shared occurrence engine for both sides of the comparison.

The daily digest is a Pacific-calendar daily operation, including DST, weekends, no-gap checks, and restart catch-up. Processing a no-gap day counts as that day's check, not an email sent.

**Why:** otherwise polling could send an unplanned later digest after a day that was correctly empty at 7 AM. Recipient notification history prevents repeat delivery when a partial batch retries.

**How to apply:** retain distinct event and date deduplication keys. Do not promise punctual production delivery from an in-process timer unless the API stays running; use an always-on process or a timezone-aware scheduled invocation.
