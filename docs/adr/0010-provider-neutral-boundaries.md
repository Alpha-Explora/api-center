---
title: Provider-neutral boundaries
status: active
authority: normative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "2026-11-24"
verification: repository
sources: [docs/superpowers/plans/2026-11-24-provider-neutral-boundaries.md, scripts/contracts/validate-public-contracts.ts, scripts/contracts/provider-terms.cjs, contracts/public/provider-terms.json]
---
# Provider-neutral boundaries

## Context

Products call APICenter instead of vendors, so that a vendor change stays inside APICenter. The 2026-11-24 audit found that this held for credentials but not for the contract or for data:
- Payment IDs were the provider's IDs with a swapped prefix.
- Provider error codes, messages and response bodies reached callers.
- Geocoding returned the provider's raw result.
- SMS message IDs were the provider's.
- Public docs named vendors.

## Decision

APICenter is provider-neutral at its boundary. It runs one vendor per capability and keeps the ability to switch.

- **Contract.** The public HTTP contract, the event contract, the SDK, error responses and the public docs never name a vendor or carry a vendor's raw data. Payment methods (`card`, `gcash`, `paymaya`, `qrph`) and payment rails (`instapay`) are not vendors. Google login is a named capability by design. `contracts/public/provider-terms.json` lists the forbidden terms and the exceptions, and the contract validator and the docs check enforce it.
- **IDs.** APICenter mints every public ID. A provider's ID is stored as data beside the APICenter ID and never derived from it. Existing provider-derived payment and SMS IDs were replaced once, with a 90-day mapping for products that stored them.
- **Errors.** Callers receive APICenter error codes. Provider codes, messages and bodies are logged with the request ID, not returned.
- **Code.** Each external capability is called through one interface, with adapters chosen by configuration. Every adapter passes the same conformance suite. Timeouts, circuit breakers and metrics wrap the interface.
- **Events.** Signed webhooks (Standard Webhooks) are the default delivery. Google Cloud Pub/Sub push remains an option for consumers on Google Cloud.

**Deprecation.** A customer-visible removal is announced first: the item is marked `deprecated: true` in the contract and the SDK, responses that use it send `Deprecation` and `Sunset` headers, and the change is recorded in `CHANGELOG.md`. It is removed no earlier than 90 days later, and only in a major version of the SDK and contracts.

## Not done until a trigger occurs

These are deferred until a vendor refuses a needed feature, freezes the account, materially raises prices, or a product needs a capability the vendor lacks:
- a second payments or geocoding adapter
- generic OIDC login, more workload identity issuers, and the console's sign-in provider
- leaving Google Cloud (Secret Manager, internal Pub/Sub, Cloud Scheduler, Cloud Run service authentication)

## Consequences

Some lock-in remains whatever the code does:
- Card tokens and subscriptions stay with the payment provider.
- Merchant onboarding with a new payment provider takes weeks.
- SMS sender names are registered per SMS vendor.
- Email sender domains are verified per email vendor.
- Cached provider geocoding results cannot be reused with another provider.

A switch is a planned migration, not a configuration flip.
