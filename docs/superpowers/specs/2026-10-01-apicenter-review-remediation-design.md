# APICenter review remediation design

## Goal

Repair the seven findings from the 2026-10-01 repository review so that the public payment contract, payment authorization, service images, shared-service behavior, retries, CI, and boundary checks agree with the code that is deployed.

## Constraints

- Keep supported payment operations in contracts/public/apicenter.openapi.yaml as the consumer-facing contract; remove unsupported standalone payment-method setup operations.
- Preserve the separate NestJS gateway and shared-service runtimes.
- Require an authenticated payment principal for every non-webhook payment operation. Unknown payment operations fail closed.
- Derive tenant and environment from the authenticated principal, never from consumer-supplied body or headers.
- Use the existing Resend integration for email and Twilio for SMS. Missing production credentials cause a clear service error, never a false "sent" result.
- Use shared storage for OTP, delivery status, idempotency, and rate limits when runtimes scale beyond one process. Local memory is only a development mode.
- Do not make external calls to PayMongo, Twilio, or Resend during automated tests.

## Payment boundary

The gateway maps each public operation to an explicit runtime operation and translates request and response bodies. Authorization is a table keyed by HTTP method and public route pattern, with a required scope for every entry. The runtime receives gateway identity in dedicated headers protected by an internal shared secret; it validates the secret before accepting tenant identity. Runtime reads and mutations query ownership by tenant and environment before reaching the provider. Webhooks retain independent signature validation.

The shared_payment schema durably maps checkout, customer, subscription, intent, refund, and invoice references to their owning projects and environments, and stores the reconciliation metadata APICenter needs. PayMongo remains the source of truth for provider resource records. A resource without an owner record fails closed rather than falling back to a provider-wide fetch. HTTP integration tests send requests through both gateway and payment runtime and verify the public response shape.

## Retry behavior

The gateway forwards the original Idempotency-Key to the runtime and sets a finite upstream timeout. A claimed key has a short processing lease. Successful responses are retained for the replay period. An ambiguous timeout or 5xx response remains durably reserved. The gateway retries with the same provider key only within PayMongo's idempotency retention window; unresolved outcomes beyond that window return a conflict for reconciliation and are never treated as a new charge.

## Shared services

The SMS runtime sends through Twilio and returns the provider's accepted or queued state. The email runtime keeps Resend. OTP generation saves a hash of the code in shared storage, dispatches it through the selected channel, and only then acknowledges generation. Verification uses an atomic consume operation so two instances cannot accept the same code. Delivery status, rate limits, and idempotency use shared storage in production; memory adapters remain available for local tests.

Email/SMS sends and OTP generate/verify require idempotency keys scoped by authenticated consumer, tribe, environment, and operation. A single atomic claim holds a short lease; a completed HTTP status/body replays for seven days. Payload changes and concurrent reuse fail with HTTP 409. Provider or runtime outcomes that cannot be confirmed stay blocked for reconciliation rather than being sent again. Payment reservations and their processing leases are also claimed atomically.

## Build and validation

Each runtime image builds TypeScript in a build stage and starts dist/server.js in a minimal runtime stage. CI performs a locked install, compiles and tests every workspace with a runnable script, validates contracts, environment names, and boundaries, and smoke-tests the gateway and payment/shared-service images. Boundary validation resolves TypeScript path aliases and no longer relies on historical paths.

## Verification

Use unit tests for route authorization, payload mapping, tenant ownership, idempotency transitions, OTP atomic consumption, and provider adapters. Use HTTP integration tests for gateway-to-payment-runtime behavior. CI builds every image and probes health; local image verification depends on Docker access. Keep live provider delivery and Cloud Run rollout as separate, credential-dependent verification.
