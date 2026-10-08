---
name: Coordinator dispatch workflow
description: Business purpose and freshness requirements of the admin home and phone schedule.
---

The admin home is the coordinator's main tool for deciding which volunteer gets the next caller in Find Help. It must load fast and read at a glance on a phone.

**Why:** the user explicitly identified this as an operational dispatch tool, not a general reporting dashboard.

**How to apply:** prioritize current volunteer contact details and shift end times over secondary information. Keep the live view refreshed every 60 seconds. Display the last successful server update time, not a client clock that implies a stale snapshot is fresh; a failed refresh must visibly mark retained information as not live.
