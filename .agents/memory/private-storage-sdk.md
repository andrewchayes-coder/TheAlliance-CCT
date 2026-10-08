---
name: Private storage SDK
description: Provisioning and bundling quirks observed with the official object-storage SDK.
---
Do not reprovision storage merely because the SDK's automatic default-bucket discovery fails.

**Why:** storage setup succeeded and installed the default-bucket environment setting, but an argument-free SDK client still failed with “A bucket name is needed.” Explicitly using the already configured bucket worked.

**How to apply:** distinguish missing SDK discovery from missing storage provisioning. Pass the runtime default bucket configuration, never a hardcoded bucket or a printed secret.

Keep the official SDK intact when externalizing its Google Cloud dependencies in an esbuild API bundle.

**Why:** bundling the SDK while leaving its Google storage import external made Node resolve that transitive import from the API package. pnpm's isolated dependency layout then produced a runtime module-not-found error, despite source tests working.

**How to apply:** externalize the complete SDK package so Node resolves its own dependency tree; check the built server, not just TypeScript/source execution.
