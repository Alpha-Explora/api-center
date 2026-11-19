# Infrastructure

Provider-owned infrastructure and deployment manifests for the management UI.

- `gcp/` - Google Cloud notes for the console.

The console is deployed to Cloud Run as `apicenter-management-test` from the workspace image build
(`infra/gcp/cloud-build/apicenter-workspace-images.json`). Next.js, lint and TypeScript entrypoint files remain at the
app root because their tools expect them there.