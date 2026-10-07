---
name: Drizzle-Zod validation and inference
description: Preserve nullable/defaulted fields and prevent incorrect Buffer inference in shared schemas.
---

A direct Zod schema passed as a Drizzle-Zod field override replaces the generated field schema, including its nullable and optional wrappers. Explicitly add nullable/optional wrappers for nullable columns and optional wrappers for columns with database defaults.

**Why:** seed validation rejected legitimate null certification/background-check dates when direct date refinements accidentally removed the generated nullability. This was caught before any seed records were inserted.

**How to apply:** when adding or refining insert validators, test both a populated field and an omitted/defaulted or null field as appropriate. Do not assume table nullability is automatically retained after a direct override.

The schema package needs Node typings when using Drizzle-Zod, even though its schema is also imported by browser code.

**Why:** Drizzle-Zod's conditional types reference the global Buffer type. With Node types excluded and skipLibCheck enabled, unresolved Buffer caused string columns to be emitted as Buffer validators in generated declarations, although runtime string validation was correct.

**How to apply:** include @types/node for the schema package and Node in its compiler types. If exported insert types unexpectedly contain Buffer for text columns, fix the missing type context instead of hiding it with individual casts.

Compose a generated API schema with validators from the same Zod entrypoint/version as that schema, not automatically the entrypoint used by shared database validators.

**Why:** this project has generated API validators using root Zod v3 alongside shared Drizzle validators using Zod v4. Extending the generated object with v4 fields produced incompatible internal-parser types rather than a usable boundary validator.

**How to apply:** inspect the generated schema import before extending/refining it. Keep API boundary overrides version-compatible; do not cast away version mismatches.
