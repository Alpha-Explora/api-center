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

- Add the contract-backed APICenter 2.0.0 server-side SDK for shared services and payments.
- Allow payment-intent confirmation with a payment method, return URL, and client key, and return the provider's next action for customer redirects.

### Changed

- Expose project/service setup checks through the gateway, SDK and console, preserve React hook order, and revalidate payment API-key lifecycle state.

- Replace the generic public landing page with APICenter-specific gateway, registry, governance and shared-service content and clear console/docs entry points.
- Support HTTPS payment-event receivers outside Cloud Run and configurable OIDC audiences while retaining environment and endpoint validation.
- Authenticate private payment runtime calls, preserve uncertain proxy outcomes, restore scoped service JWT payment access, verify Google tokens against registered clients, and bound authenticated health sweeps.
- Bound gateway database pools to two connections per instance by default and allow canonical audit writes on legacy schemas without deleting historical audit values.
- Explain and test explicit legacy-environment conversion before editing registrations, preserving test/live-only writes and live approval checks.

- Limit new service registrations to test/live, submit live approval confirmations, preserve OAuth form drafts during refreshes, and use the versioned membership route.

- Refresh consumer and Management guidance for SDK 2.0.0, organization-scoped access, service registration, and project Google sign-in. Keep operator procedures in the internal `docs/` collection.
- Added APICenter's canonical internal docs bundle with ownership, authority, evidence, and plan-retirement rules.
- Published all registered consumer guides, including Payment Links, Google Auth, and payment architecture; retained the payment-intents alias.
- Rendered guide links and tables with native MDX and removed leaked frontmatter and generic framework guidance.
- Derived payment reference facts from the public contract, corrected API-key authentication and 201/202 responses, and replaced synthetic shared endpoint pages with maintained-guide notices.
- Corrected narrow-screen endpoint layout and kept code examples available below the title.
- Added fast documentation checks on relevant PRs while keeping expensive CI and artifact publication manual.
