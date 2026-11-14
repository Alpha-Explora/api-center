# Changelog

User-visible changes are recorded under Unreleased until a release is cut. This file starts with the documentation governance update; it does not reconstruct previous releases.

## Unreleased

### Fixed

- Build shared contracts before compiling gateway images that consume project setup status types.
- Preserve gateway workspace-local dependencies through Docker build/runtime stages and keep the workspace directory layout for Node module resolution.
- Recognize completed PayMongo payments in active checkout sessions, refresh checkout reads by ID and reference, and reconcile saved status without regressing confirmed payments. Include webhook signing-secret references on gateway deployments.
- Refresh refunds from PayMongo on reads and apply signed refund status events without regressing terminal refund states.
- Reconcile payment-link archive responses against the current owner so concurrent paid webhooks and provider archive fields are both preserved.
- Persist fresh payment-intent, subscription, and invoice reads while preserving owner metadata and confirmed terminal states. Clear completed intent redirects and preserve aggregate versions when provider facts are unchanged.
- Register the provider payment found during checkout polling so the existing refund path can resolve it.

### Added

- Add the APICenter control plane: organization-owned projects with separate test and live environments, applications with explicit grants, and `ak_test_`/`ak_live_` application keys. Applications call every shared service and payments without registering a service, URL or routes; the gateway forwards a short-lived Ed25519-signed runtime context that every runtime verifies. Adds console roles (owner, admin, developer, viewer), teams and project roles enforced by the gateway; PostgreSQL row-level tenant isolation; project plans, request budgets and usage; approved live activation; optional published APIs with approved cross-project grants and SSRF-guarded upstreams; per-environment payment event destinations; and a fenced, shadowed, reversible migration from tribes, projects and services. Requires migrations `20261114000100`–`20261114000900` and runtime context keys.
- Add the console Workspace section (Projects, People, Migration).
- SDK 2.1.0: `auth: { apiKey }` for application keys, `createContextVerifier` for published APIs, and payment event contract 1.1 (`ownerGroupId`, `ownerProjectId`; `ownerTribeId` kept for 1.0 consumers).
- Contracts 0.2.0 for SDK 2.1.0: the published contracts package now carries the shared-service HTTP operations and payment event contract 1.1 (0.1.0 shipped with SDK 2.0.0).
- Add service go-live checks, protected verification runs tied to deployed revisions, payment key metadata and targeted revocation, and controlled service-secret rotation.
- Add redacted request diagnostics and tenant-scoped payment event replay with immutable operation IDs and reconciliation gates.
- Publish supported shared-service and identity HTTP operations in the consumer OpenAPI, with matching reference pages and credential-aware examples.
- Add a manual release verification workflow and sanitized reports. Provider and deployment acceptance require protected environment configuration.

- Add the contract-backed APICenter 2.0.0 server-side SDK for shared services and payments.
- Allow payment-intent confirmation with a payment method, return URL, and client key, and return the provider's next action for customer redirects.

### Changed

- Verify the existing enabled test-payment database secret reference and guard against reverting to a destroyed historical version.

- Preserve internal payment-runtime ingress during hosted manifest reconciliation and document the separately observed live ingress drift.

- Prepare canonical hosted API/docs hostnames, private-runtime invocation from Management, static docs containers and build-context exclusions; retain existing scaling caps and dated rollout evidence.

- Expose project/service setup checks through the gateway, SDK and console, preserve React hook order, and revalidate payment API-key lifecycle state.

- Replace the generic public landing page with APICenter-specific gateway, registry, governance and shared-service content and clear console/docs entry points.
- Support HTTPS payment-event receivers outside Cloud Run and configurable OIDC audiences while retaining environment and endpoint validation.
- Authenticate private payment runtime calls, preserve uncertain proxy outcomes, restore scoped service JWT payment access, verify Google tokens against registered clients, and bound authenticated health sweeps.
- Bound gateway database pools to two connections per instance by default and allow canonical audit writes on legacy schemas without deleting historical audit values.
- Explain and test explicit legacy-environment conversion before editing registrations, preserving test/live-only writes and live approval checks.

- Limit new service registrations to test/live, submit live approval confirmations, preserve OAuth form drafts during refreshes, and use the versioned membership route.

- Refresh consumer and Management guidance for SDK 2.0.0, organization-scoped access, service registration, and project Google sign-in. Keep operator procedures in the internal `docs/` collection.
- Deploy the APICenter gateway, management console, developer docs, payments, and shared runtimes to Blaine-billed Cloud Run with the `apicenter` service names.
- Start the APICenter Supabase catalog with a fresh organization and no old tribes, projects, or service records; register the deployed shared runtimes.
- Add IAM ID-token authentication from the management console and gateway to private Cloud Run services.
- Allow the deployed gateway to use private Redis and verify each shared-service database login.
- Serve the built developer docs from their static export with the docs workspace start command.
- Include UI, documentation, and root configuration changes in Turborepo cache inputs and preserve exported docs in build outputs.
- Exclude nested environment files and dependency directories from Docker build contexts.

- Added APICenter's canonical internal docs bundle with ownership, authority, evidence, and plan-retirement rules.
- Published all registered consumer guides, including Payment Links, Google Auth, and payment architecture; retained the payment-intents alias.
- Rendered guide links and tables with native MDX and removed leaked frontmatter and generic framework guidance.
- Derived payment reference facts from the public contract, corrected API-key authentication and 201/202 responses, and replaced synthetic shared endpoint pages with maintained-guide notices.
- Corrected narrow-screen endpoint layout and kept code examples available below the title.
- Added fast documentation checks on relevant PRs while keeping expensive CI and artifact publication manual.
