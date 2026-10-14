---
name: OpenAPI parameter name collisions
description: Orval's path schemas and query interfaces can collide when re-exported together.
---
When an operation has both path parameters and query parameters, Orval can emit a
Zod path schema and a query interface with the same operation-plus-Params name.
Star-exporting both generated modules then fails TypeScript.

**Why:** adding a development clock query to parameterized hours routes exposed
this generator naming collision; generation itself succeeded but shared exports failed.

**How to apply:** explicitly prefer the Zod path-schema export in the Zod package's
handwritten barrel. Client query types remain available from the client package.
Never patch generated files; regeneration must reproduce the contract.
