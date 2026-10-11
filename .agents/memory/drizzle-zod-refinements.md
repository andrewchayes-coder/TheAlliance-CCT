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

SQL operators and their table types must resolve to the same ORM instance across workspace packages.

**Why:** adding Lighthouse introduced an optional OpenTelemetry peer into the scripts dependency graph. pnpm created a second Drizzle instance of the same version, causing SQL private-member type conflicts against the database package's tables.

**How to apply:** scripts working with database-exported tables should obtain operators from the database package too. Do not hide cross-instance SQL errors with casts or assume identical version numbers imply identical peer resolutions.

Multipart code generation also needs Node types when it emits `z.instanceof(Blob)` in server-only validators.

**Why:** generated binary upload validators refer to the runtime Blob global, but a server tsconfig without Node types cannot resolve its declaration. Adding browser DOM libraries masks the missing server type context.

**How to apply:** use the supported Node type context for generated validator packages; keep multipart bodies named in the specification to avoid root re-export collisions between inferred schemas and generated body types.

Compose a generated API schema with validators from the same Zod entrypoint/version as that schema, not automatically the entrypoint used by shared database validators.

**Why:** this project has generated API validators using root Zod v3 alongside shared Drizzle validators using Zod v4. Extending the generated object with v4 fields produced incompatible internal-parser types rather than a usable boundary validator.

**How to apply:** inspect the generated schema import before extending/refining it. Keep API boundary overrides version-compatible; do not cast away version mismatches.

Check the installed Zod runtime before using newer object-composition helpers. Build extensions from an unrefined base, then apply the same cross-field checks to every final schema.

**Why:** this project's Zod v4 entrypoint did not provide `safeExtend`. A version-looking import is not a guarantee that a recently introduced method exists; relying on it caused an import-time server failure.

**How to apply:** confirm helpers against the installed package. Keep uniqueness and audience/recipient cardinality checks on both preview and send schemas rather than relying on extension to preserve refinements.
