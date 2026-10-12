---
title: "APICenter SDK redesign specification"
status: reference
authority: informative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "unverified"
verification: unverified
sources: ["AGENTS.md", "docs/architecture/current-architecture.md", "docs/research/2026-10-12-sdk-design-patterns.md", "packages/sdk", "packages/contracts", "apps/gateway/src/domains/auth-security", "apps/gateway/src/domains/payments"]
---
# APICenter SDK redesign specification

This records the approved design direction for the SDK overhaul. The implementation is in the repository as of 2026-10-12; this specification remains the rationale and acceptance reference, not a claim that implementation work is still pending.

## Goal

Give an application in an Alpha Explora organization one supported TypeScript client for calling APICenter. The first release covers the existing shared services and payment facade. The design leaves room for typed clients for organization-owned APIs after APICenter can publish their contracts.

The client must make the first useful task straightforward: configure a registered service, send email or SMS, generate and verify an OTP, geocode an address, and call payments when the service has the required scope.

## Starting state (historical)

The following bullets describe the repository before the overhaul implementation.

- The package exports `PaymentsClient`, `SharedServicesClient`, and `TribeClient`. A caller can use `SharedServicesClient` alone, but it must first obtain a service token. `TribeClient` requires both payment and shared-service credentials.
- `POST /api/v1/auth/token` accepts a service ID, environment, and service secret. The gateway resolves the service placement and grants scopes. The token response includes service, project, and tribe identity; it may include a refresh token. The SDK does not issue or refresh these tokens.
- The payment client accepts an `apiKey` string. The gateway accepts configured `apic_` keys and sends other bearer tokens through JWT authentication. A service token still needs the payment scopes required by each operation.
- Payment and shared-service clients duplicate request and response handling. `ApiCenterError` is defined in the payment implementation and imported by the shared-service implementation.
- `packages/contracts` contains some shared-service TypeScript types and a route/wrapper manifest, but the repository does not currently have one complete public OpenAPI contract for all shared services. The SDK also defines several public types itself.
- The root README, SDK README, consumer guide, and generated API snippets show different client shapes. The generated snippets import `@apicenter/sdk` and `ApiCenterClient`, which the package does not export.
- The package is distributed through restricted GitHub Packages. Consumers need the Alpha Explora registry mapping and package read access.

See the [SDK research note](../../research/2026-10-12-sdk-design-patterns.md) for source links and the detailed repo audit.

## Design requirements

1. A caller creates one `ApiCenter` client and finds operations under service namespaces.
2. A caller can use any one service without configuring credentials for unrelated services.
3. APICenter's registry and token scopes remain authoritative for organization, project, service, and environment access. The SDK does not let callers change authorization by supplying organization or tribe headers.
4. The first implementation uses the current service credential and token endpoints. A caller can also supply an access-token provider when another trusted runtime owns credential exchange.
5. Payment API keys remain an explicit optional credential for consumers provisioned to use them. The SDK can use the service bearer for payments when the token has the necessary scopes.
6. The SDK runs in trusted server environments. It must not encourage putting a service secret, refresh token, or privileged service token in browser code.
7. Request and response types match the gateway and runtime contracts. The SDK must not expose an operation only because a type or example exists.
8. The maintainer confirms there are no SDK consumers outside this repository for now. Migrate every in-repository caller together and remove the old client exports as part of this breaking redesign; do not keep compatibility adapters solely for hypothetical consumers.

## Proposed client interface

Use one package entry point and group methods by APICenter service. Keep service method names short and consistent.

```ts
import { randomUUID } from "node:crypto";

const apicenter = new ApiCenter({
  baseUrl: process.env.APICENTER_URL!,
  auth: {
    serviceId: process.env.APICENTER_SERVICE_ID!,
    environment: "test",
    secret: process.env.APICENTER_SERVICE_SECRET!,
  },
});

await apicenter.email.send(
  {
    to: "person@example.com",
    subject: "Welcome",
    text: "Your account is ready.",
  },
  { idempotencyKey: randomUUID() },
);

await apicenter.otp.verify({ otpId, code, recipient });
await apicenter.geo.geocodeAddress({ address });
```

The example shows the proposed shape. The spec does not define a finished TypeScript signature until contracts and token refresh behavior are reconciled.

The initial namespaces are:

| Namespace | Initial operations |
| --- | --- |
| `email` | Send a message and get delivery status |
| `sms` | Send a message and get delivery status |
| `otp` | Generate, verify, and get status |
| `geo` | Geocode, reverse geocode, and check a geofence |
| `googleAuth` | Get an authorization URL, exchange or refresh a token, and log out |
| `payments` | Preserve the existing supported checkout, intent, customer, plan, payment-link, refund, subscription, invoice, record, and capability operations |

Use nested resource groups for larger areas such as payments. For example, prefer `apicenter.payments.checkouts.create(...)` over another flat method on the root client. Final names must match the contracts and go through a migration review before publication.

For future organization-owned APIs, generate or validate typed service clients from registered API contracts. Do not add a generic untyped request proxy as a substitute for authorization, a contract, or a usable client.

## Authentication and authorization

The client accepts an auth provider with one of these adapters:

- **Registered service credentials.** The provider uses the existing token issue endpoint, caches the access token, refreshes it before expiry, and replaces stored tokens safely when the gateway rotates them. Keep the service secret and refresh token in the server process or its secret store.
- **Caller-supplied token provider.** An application can provide an async function that returns a valid bearer token when another trusted runtime handles token exchange and storage.
- **Payment API key.** A consumer can explicitly configure a payment API key for the payment namespace. Do not silently switch credentials after a 401 or 403.

The exact precedence between a service token and payment key must be visible in the type and docs. The recommended rule is to use the service bearer for payments unless a payment key is explicitly configured for that namespace. The gateway remains responsible for checking scopes and placement.

Do not add an `organizationId`, `tribeId`, or `projectId` request header option. Today the token request identifies the registered service and environment; the gateway resolves placement and scopes. If the product needs a new organization-scoped credential model, define and authorize it in gateway contracts before adding an SDK option.

## Shared transport and errors

All namespaces use one internal HTTP transport. The transport owns base URL normalization, auth injection, JSON encoding and decoding, envelope validation, abort signals, request timeout, response headers, and error conversion. Per-call options can add safe request headers or an `AbortSignal`; callers cannot replace the authorization header accidentally.

Export one `ApiCenterError` with the HTTP status, APICenter error code, message, safe details, and gateway correlation ID when present. Handle empty and non-JSON responses consistently. Keep auth, payment, and shared-service error handling behind the same exported type.

Do not retry a mutation unless the gateway operation supports idempotency and the caller supplied the required key. Email send, SMS send, OTP generate, OTP verify, and payment mutations require caller-supplied idempotency keys under their current runtime/gateway behavior. The SDK should expose a typed `idempotencyKey` option and set the header itself. Retry policy must be bounded and must not turn an uncertain send or payment result into a second operation. The first release ships with retries disabled.

## Contract ownership

Before implementation, reconcile each method with its actual gateway route, auth scope, request body, response body, and runtime behavior. Treat `packages/contracts` and the service manifests as the source to align, not as proof that every current type or wrapper is accurate. Fill a shared-service contract gap from the route/runtime implementation, then add a drift check. Keep the public reference truthful; do not invent endpoints or schemas to make SDK generation convenient.

The contract audit must flag unsupported or unverified operations. In particular, verify the current SDK's hand-authored payment types, shared-service status responses, and the wrapper names in `shared-service-contract.json` before preserving them as public methods.

## Package and documentation

Keep the package name `@alpha-explora/apicenter-sdk` and the existing GitHub Packages distribution for the first release. Put the registry setup and package-read permission in the first-run guide. Review ESM and CommonJS consumption as part of package verification before changing module output.

Keep one canonical quickstart in the package README and consumer docs. It must show installation, server-only credential setup, one email or SMS call, one OTP call, payment authorization, errors, and environment selection. Generate API snippets from the real package exports or compile them against the package. Remove or update examples that use `@apicenter/sdk`, `ApiCenterClient`, old `TribeClient` options, or flat root methods.

## Migration

1. Inventory all imports, examples, generated snippets, and tests inside this repository. Treat the maintainer's statement that there are no outside consumers as the compatibility boundary for this rollout.
2. Add the `ApiCenter` facade and common transport, then migrate every in-repository caller to the new namespaces.
3. Remove `TribeClient`, `PaymentsClient`, and `SharedServicesClient` exports and implementations once the in-repository migration is complete. Do not retain adapters or deprecated aliases.
4. Keep the package name and restricted GitHub Packages configuration. Prepare the breaking package version in source, but do not publish it as part of this implementation unless publication is separately requested.

The clean break relies on the maintainer's confirmation that there are no outside consumers for now, not on repository search alone. Since the package is privately distributed, keep the new major version unpublished until requested; revisit the migration boundary if an outside consumer appears before release.

## Acceptance criteria

- A service that only calls email, SMS, OTP, geo, or Google Auth can initialize the new client without a payment API key.
- Service-token acquisition, refresh, and failures have documented behavior and tested concurrency handling.
- Every exported operation maps to an active gateway route and validated request and response contract.
- All namespace clients share the same transport behavior and `ApiCenterError` details.
- Unsafe operations are not automatically retried. Idempotency requirements match the gateway contract.
- The package's documented examples use real exports and compile in a consumer fixture.
- No in-repository caller imports the removed clients or the nonexistent `@apicenter/sdk` package name.
- The package exposes only the new supported client surface, with its breaking package version prepared but not published by this work.
- Package installation and runtime module formats work for the declared Node.js and TypeScript consumers.

## Review choices

The approved defaults are a server-side TypeScript SDK, current service credentials with SDK-managed token refresh, explicit payment-key support, restricted GitHub Packages distribution, and a clean breaking change because there are no outside consumers for now. Revisit compatibility and publication policy if that boundary changes.
