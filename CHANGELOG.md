# Changelog

User-visible changes are recorded under Unreleased until a release is cut. This file starts with the documentation governance update; it does not reconstruct previous releases.

## Unreleased

### Added

- Add the APICenter control plane: organization-owned projects with separate test and live environments, applications with explicit grants, and `ak_test_`/`ak_live_` application keys. Applications call every shared service and payments without registering a service, URL or routes; the gateway forwards a short-lived Ed25519-signed runtime context that every runtime verifies. Adds console roles (owner, admin, developer, viewer), teams and project roles enforced by the gateway; PostgreSQL row-level tenant isolation; project plans, request budgets and usage; approved live activation; optional published APIs with approved cross-project grants and SSRF-guarded upstreams; per-environment payment event destinations; and a fenced, shadowed, reversible migration from tribes, projects and services. Requires migrations `20261114000100`–`20261114000900` and runtime context keys.
- Add the console Workspace section (Projects, People, Migration).
- SDK 2.1.0: `auth: { apiKey }` for application keys, `createContextVerifier` for published APIs, and payment event contract 1.1 (`ownerGroupId`, `ownerProjectId`; `ownerTribeId` kept for 1.0 consumers).
- Add service go-live checks, protected verification runs tied to deployed revisions, payment key metadata and targeted revocation, and controlled service-secret rotation.
- Add redacted request diagnostics and tenant-scoped payment event replay with immutable operation IDs and reconciliation gates.
- Publish supported shared-service and identity HTTP operations in the consumer OpenAPI, with matching reference pages and credential-aware examples.
- Add a manual release verification workflow and sanitized reports. Provider and deployment acceptance require protected environment configuration.

- Add the contract-backed APICenter 2.0.0 server-side SDK for shared services and payments.

### Changed

- Bound gateway database pools with `DATABASE_POOL_MAX` and default to two connections per instance so session-pooler capacity can accommodate rollout revisions.
- Restrict new service registration environments to `test` and `live`; add live approval, reason, and confirmation fields and submit them through Management to the gateway.
- Configure canonical Management, API, and developer docs hostnames under `apicenter.itsandbox.site`; align SDK examples, onboarding, and contract server URLs with `api.apicenter.itsandbox.site`. Keep shared runtimes behind Google IAM and consumer access behind APICenter authorization.
- Refresh consumer and Management guidance for SDK 2.0.0, organization-scoped access, service registration, and project Google sign-in. Keep operator procedures in the internal `docs/` collection.
- Deploy the APICenter gateway, management console, developer docs, payments, and shared runtimes to Blaine-billed Cloud Run with the `apicenter` service names.
- Start the APICenter Supabase catalog with a fresh organization and no old tribes, projects, or service records; register the deployed shared runtimes.
- Add IAM ID-token authentication from the management console and gateway to private Cloud Run services.
- Allow the deployed gateway to use private Redis and verify each shared-service database login.
- Use the versioned gateway membership route so Google sign-in and the dashboard share an origin-only API base URL.
- Keep unsaved Google sign-in settings during background refreshes and reset the form when switching project or environment.
- Serve the built developer docs from their static export with the docs workspace start command.
- Include UI, documentation, and root configuration changes in Turborepo cache inputs and preserve exported docs in build outputs.
- Exclude nested environment files and dependency directories from Docker build contexts.

- Added APICenter's canonical internal docs bundle with ownership, authority, evidence, and plan-retirement rules.
- Published all registered consumer guides, including Payment Links, Google Auth, and payment architecture; retained the payment-intents alias.
- Rendered guide links and tables with native MDX and removed leaked frontmatter and generic framework guidance.
- Derived payment reference facts from the public contract, corrected API-key authentication and 201/202 responses, and replaced synthetic shared endpoint pages with maintained-guide notices.
- Corrected narrow-screen endpoint layout and kept code examples available below the title.
- Added fast documentation checks on relevant PRs while keeping expensive CI and artifact publication manual.
