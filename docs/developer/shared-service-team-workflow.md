# Shared Service Team Workflow

This document defines how AP Center and shared-service teams collaborate without tight coupling.

## Ownership Boundaries

- AP Center team owns runtime control-plane behavior:
  - Auth verification and policy enforcement
  - Service discovery and routing
  - Rate limits, circuit breakers, metrics, and audit events
- Shared SDK team owns tribe-facing contracts in `api-shared-services`.
- Shared service runtime teams own provider-specific integrations (for example PayMongo) in their runtime service repositories.

## Delivery Flow for New Shared Service Capabilities

1. Contract proposal
   - Define new route contract, required scopes, and error model.
   - Example payment draft routes:
     - `POST /api/v1/shared/payment/checkout/sessions`
     - `GET /api/v1/shared/payment/checkout/sessions/:checkoutId`
     - `POST /api/v1/shared/payment/payments/:paymentId/refunds`
2. AP Center policy and routing readiness
   - Ensure required scopes are enforced through AP Center auth policy.
   - Ensure shared service is registered with `serviceType: "shared"`.
3. SDK wrapper release
   - Add typed SDK methods that call AP Center shared routes.
   - Release new SDK version from `api-shared-services`.
4. Shared service runtime implementation
   - Runtime team implements provider-specific logic behind the shared service API.
   - Until provider API is final, return stable mock responses that satisfy contract shape.
5. Tribe adoption
   - Tribes upgrade SDK and integrate against stable SDK methods.
   - Tribes do not call provider APIs directly.

## Descope Responsibility

- AP Center remains the source of truth for token verification and scope enforcement.
- Shared service runtime can trust AP Center forwarded identity headers and does not need to duplicate AP Center authorization policy.

## Non-breaking Contract Rule

- Additive fields and new optional routes: minor SDK release.
- Renames or payload shape changes: major SDK release with migration notes.
- AP Center must keep old behavior during migration windows where possible.