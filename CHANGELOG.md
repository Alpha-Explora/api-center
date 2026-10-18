# Changelog

User-visible changes are recorded under Unreleased until a release is cut. This file starts with the documentation governance update; it does not reconstruct previous releases.

## Unreleased

### Fixed

- Recognize completed PayMongo payments in active checkout sessions, refresh checkout reads by ID and reference, and reconcile saved status without regressing confirmed payments. Include webhook signing-secret references on gateway deployments.
- Refresh refunds from PayMongo on reads and apply signed refund status events without regressing terminal refund states.

### Added

- Add the contract-backed APICenter 2.0.0 server-side SDK for shared services and payments.
- Allow payment-intent confirmation with a payment method, return URL, and client key, and return the provider's next action for customer redirects.

### Changed

- Refresh consumer and Management guidance for SDK 2.0.0, organization-scoped access, service registration, and project Google sign-in. Keep operator procedures in the internal `docs/` collection.
- Added APICenter's canonical internal docs bundle with ownership, authority, evidence, and plan-retirement rules.
- Published all registered consumer guides, including Payment Links, Google Auth, and payment architecture; retained the payment-intents alias.
- Rendered guide links and tables with native MDX and removed leaked frontmatter and generic framework guidance.
- Derived payment reference facts from the public contract, corrected API-key authentication and 201/202 responses, and replaced synthetic shared endpoint pages with maintained-guide notices.
- Corrected narrow-screen endpoint layout and kept code examples available below the title.
- Added fast documentation checks on relevant PRs while keeping expensive CI and artifact publication manual.
