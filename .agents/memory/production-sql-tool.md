---
name: Production SQL tool
description: SQL formatting constraints for operator-run production data cleanup.
---
The user's Production Database tool splits input at every semicolon. Supply standalone statements, one statement per line ending in a semicolon. Avoid transaction wrappers, DO blocks, stored functions, and multi-statement CTE scripts.

**Why:** The user explicitly described this parser while requesting an operator-run seed-data cleanup.

**How to apply:** Put prerequisite checks before destructive statements, delete children before parents, make each statement safely repeatable, and provide post-checks. Never assume a pasted script runs atomically.
