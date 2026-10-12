# Changelog

User-visible changes are recorded under Unreleased until a release is cut. This file starts with the documentation governance update; it does not reconstruct previous releases.

## Unreleased

### Added

- Add the contract-backed APICenter 2.0.0 server-side SDK for shared services and payments.

### Changed

- Added APICenter's canonical internal docs bundle with ownership, authority, evidence, and plan-retirement rules.
- Published all registered consumer guides, including Payment Links, Google Auth, and payment architecture; retained the payment-intents alias.
- Rendered guide links and tables with native MDX and removed leaked frontmatter and generic framework guidance.
- Derived payment reference facts from the public contract, corrected API-key authentication and 201/202 responses, and replaced synthetic shared endpoint pages with maintained-guide notices.
- Corrected narrow-screen endpoint layout and kept code examples available below the title.
- Added fast documentation checks on relevant PRs while keeping expensive CI and artifact publication manual.
