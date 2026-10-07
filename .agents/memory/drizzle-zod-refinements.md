---
name: Drizzle-Zod refinements
description: Preserve nullable and defaulted column behavior when customizing insert schemas.
---

A direct Zod schema passed as a Drizzle-Zod field override replaces the generated field schema, including its nullable and optional wrappers. Explicitly add nullable/optional wrappers for nullable columns and optional wrappers for columns with database defaults.

**Why:** seed validation rejected legitimate null certification/background-check dates when direct date refinements accidentally removed the generated nullability. This was caught before any seed records were inserted.

**How to apply:** when adding or refining insert validators, test both a populated field and an omitted/defaulted or null field as appropriate. Do not assume table nullability is automatically retained after a direct override.
