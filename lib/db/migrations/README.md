# Reference-only migrations

These SQL files and metadata record historical schema changes. They are not the
production deployment mechanism and must never be run as a migration chain or at
application startup. Do not baseline or invoke Drizzle migrate for this project.

Replit Publish owns the additive development-to-production schema diff. Review
DEPLOY.md first: the new status enum value requires a separate, operator-approved
pre-Publish statement. Never seed production or copy development data.
