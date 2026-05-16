# Shared Service Team Workflow

This document defines how AP Center and shared-service teams collaborate without tight coupling.

## Repository Split

AP Center and shared services are intentionally split across two repositories:

- `api-center` owns the gateway runtime. It verifies tokens, maintains the service registry, enforces policy, proxies requests, records metrics, and emits audit/runtime events.
- `api-shared-services` owns the tribe-facing SDK package, shared-service registration manifests, contract snapshots, and platform-owned shared-service runtime scaffolds.

AP Center should stay runtime-only. Shared-service source code and manifests should not be copied into this repository except for generated or versioned contract snapshots that AP Center validates against.

## Ownership Boundaries

- AP Center team owns runtime control-plane behavior:
  - Auth verification and policy enforcement
  - Service discovery and routing
  - Rate limits, circuit breakers, metrics, and audit events
- Shared SDK team owns tribe-facing contracts in `api-shared-services`.
- Shared service runtime teams own provider-specific integrations (for example PayMongo) in their runtime service repositories.

## Runtime Request Path

Shared service calls always enter through AP Center. A tribe should not call the shared-service container or provider API directly.

```text
tribe service
  -> @implementsprint/sdk
  -> AP Center /api/v1/shared/:serviceId/*
  -> registry lookup and policy checks
  -> shared service baseUrl from registry
  -> provider-specific runtime logic
```

For example, `client.paymentCreateCheckoutSession(...)` in the SDK calls:

```text
POST /api/v1/shared/payment/checkout/sessions
```

AP Center then strips `/api/v1/shared/payment` and proxies the request to the registered payment service as:

```text
POST /checkout/sessions
```

The shared-service runtime receives trusted AP Center forwarding headers such as `X-Tribe-Id`, `X-Correlation-ID`, and `X-Forwarded-By: apicenter-gateway`.

## Registry and Access Model

Every routable service is represented by a registry manifest. Shared services must use:

```json
{
  "serviceId": "payment",
  "serviceType": "shared",
  "baseUrl": "http://payment-service:4010",
  "requiredScopes": ["payment:charge", "payment:refund"],
  "exposes": ["/checkout/sessions", "/checkout/sessions/:id", "/payments/:id/refunds"],
  "consumes": []
}
```

Caller access is controlled by the caller's manifest, not by the shared service alone. A tribe can call `payment` only when its own manifest includes:

```json
{
  "serviceId": "orders-service",
  "consumes": ["payment"]
}
```

When AP Center issues a token for `orders-service`, it derives scopes from the service's own requirements plus the services listed in `consumes`. During proxying, AP Center checks both conditions:

- The caller is allowed to consume the target service.
- The caller token contains the target service's required scopes.

If either condition fails, AP Center rejects the request before it reaches the shared-service runtime.

## What AP Center Enforces

For `/api/v1/shared/:serviceId/*`, AP Center is responsible for:

- JWT validation through the configured auth provider.
- Namespace validation, so a `shared` service cannot be called through `/tribes` and a `tribe` service cannot be called through `/shared`.
- Lifecycle gates for active, deprecated, and retired services.
- Consumer allow-listing through the caller manifest's `consumes` array.
- Required-scope enforcement against the caller token.
- Per-service circuit breaking and proxy timeout handling.
- Proxy cache invalidation when a service re-registers with a changed `baseUrl`.
- Metrics and audit context propagation.

The shared-service runtime is responsible for provider behavior behind the stable contract, such as PayMongo API calls, webhook validation, provider idempotency, and provider-specific error translation.

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

## SDK Consumption Rules

Tribe services consume shared services through `@implementsprint/sdk`, which is released from `api-shared-services`.

The SDK wraps gateway routes only. It does not bypass AP Center policy and it does not contain AP Center auth-provider internals. Typical flow:

1. Construct `TribeClient` with `gatewayUrl`, `tribeId`, and the tribe secret.
2. Call `authenticate()` or let the first SDK call authenticate automatically.
3. Use typed wrappers such as `emailSend`, `smsSend`, `paymentCreateCheckoutSession`, `gauthExchangeCode`, or the generic `callSharedService`.
4. Handle SDK error classes for authentication, authorization, rate-limit, timeout, unavailable, and not-found failures.

Before a tribe integration is considered ready, verify:

- The tribe is registered in AP Center.
- `api-center-tribe-secret-<service-id>` exists in Secret Manager and stores
  only the tribe secret SHA-256 hash.
- The shared service is registered with `serviceType: "shared"`.
- The tribe manifest includes the shared service ID in `consumes`.
- The SDK method maps to a route listed in the shared-service manifest and contract snapshot.

## Auth Provider Responsibility

- AP Center remains the source of truth for tribe token issuance, token verification,
  registry-derived scopes, and scope enforcement.
- In `AUTH_PROVIDER=composite` or `AUTH_PROVIDER=internal-jwt`, tribes do not need
  a Descope app for API Center machine-to-machine access. AP Center validates
  the per-tribe Secret Manager hash and signs an internal JWT.
- Descope remains for human/user identity and management-console login flows, not
  for one OAuth client per tribe.
- Shared service runtime can trust AP Center forwarded identity headers and does not need to duplicate AP Center authorization policy.

## Non-breaking Contract Rule

- Additive fields and new optional routes: minor SDK release.
- Renames or payload shape changes: major SDK release with migration notes.
- AP Center must keep old behavior during migration windows where possible.
