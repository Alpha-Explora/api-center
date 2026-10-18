# Documentation bundle changes

## 2026-10-19

- Updated payment recovery ownership to describe payment records registered by checkout polling, while retaining signed webhook receipts and event publication as separate operations.

## 2026-10-17

- Documented checkout status reconciliation, the distinction between polling and webhook events, and recovery of disabled PayMongo webhooks with matching secrets on gateway and payments runtime.
- Updated the consumer refunds guide and public status contract to document refreshed provider-backed refund states.
- Deployment and provider acceptance remain separate rollout checks; this entry records repository behavior and operator instructions.
- Updated the public payment-intent guide with confirmation fields, client-key handling, and redirect completion guidance.

## 2026-10-12

- Refreshed the docs app's consumer and Management guides for SDK 2.0.0, the Organization → Tribe → Project → Service hierarchy, service credentials, and Google sign-in settings.
- Removed the active AlphaCI consumer claim from current architecture notes and marked AlphaCI-specific operator guidance as unverified reference material.
- Reviewed the updated content against the repository source; no docs build or test suite was run for this refresh.

## 2026-10-10

- Added a canonical index, maintenance rules, current architecture map, and capability/evidence register.
- Added explicit ownership, authority, audience, and verification metadata. Historical deployments and incomplete plans remain evidence-qualified.
- Consolidated guide registration, enabled native MDX rendering, and preserved legacy guide/reference bookmarks.
- Made HTTP reference facts contract-derived and corrected payment authentication, response statuses, examples, and ownership wording.
- Restored framework-owned responsive endpoint layout with accessible code examples on narrow screens.
- Added automated documentation audits, contract fidelity tests, complete static-guide/link coverage, and a lightweight PR workflow.

Verification results are recorded in the corresponding pull request. This entry does not claim current provider or deployment behavior.
