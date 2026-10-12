---
title: SDK design patterns for APICenter
status: reference
authority: informative
owner: platform-maintainers
audience: [maintainers, engineers]
last_verified: "2026-10-12"
verification: repository
sources: [packages/sdk/README.md, packages/sdk/package.json, packages/sdk/src/index.ts, packages/sdk/src/types.ts, packages/sdk/src/ApiCenter.ts, packages/sdk/src/internal/transport.ts, packages/sdk/src/internal/auth/service-token-provider.ts, packages/sdk/src/services, packages/contracts/shared-service-contract.json, apps/gateway/src/domains/auth-security/auth/auth.controller.ts, apps/gateway/src/shared/dto/token-request.dto.ts, apps/gateway/src/domains/payments/shared/payment-auth.guard.ts, README.md, apps/docs/content/docs/sdk-usage.mdx, apps/docs/components/vercel-api-doc.tsx, apps/docs/components/api-doc-layout.tsx]
---
# SDK design patterns for APICenter

Research date: 2026-10-12. Vendor notes below summarize first-party documentation; the recommendations are design inferences for APICenter, not vendor requirements.

## What mature SDKs do

- **One configured entry point, with discoverable resource namespaces.** Supabase initializes a typed client once with `createClient<Database>(url, key)` and groups capabilities such as auth under namespaces; Vercel initializes one `Vercel` object and exposes generated method groups; Stripe describes `StripeClient` as the entry point for resource discovery and requests. [Supabase TypeScript support](https://supabase.com/docs/reference/javascript/typescript-support), [Supabase Auth reference](https://supabase.com/docs/reference/javascript/auth), [Vercel SDK](https://vercel.com/docs/rest-api/sdk), [Stripe server-side SDKs](https://docs.stripe.com/sdks/server-side?lang=node)
- **Types come from authoritative contracts and track what the server actually accepts.** Supabase generates database types from the schema and uses them for input/output inference. Vercel describes its TypeScript SDK as type-safe and organizes methods by API area. APICenter should generate or mechanically validate shared-service request, response, and error types from its service contracts rather than maintain overlapping handwritten shapes. [Supabase TypeScript support](https://supabase.com/docs/reference/javascript/typescript-support), [Vercel SDK](https://vercel.com/docs/rest-api/sdk)
- **One stable error model preserves useful detail.** Stripe SDKs surface typed exceptions, while its API distinguishes conventional status codes and structured error types/codes. APICenter should normalize transport and envelope failures into one exported `ApiCenterError` carrying HTTP status, APICenter code, request/correlation ID, and safe details; document whether methods throw or return result unions and use that policy consistently. [Stripe server-side SDK error handling](https://docs.stripe.com/sdks/server-side?lang=node), [Stripe API errors](https://docs.stripe.com/api/errors)
- **Operational behavior is part of the SDK contract.** Stripe documents API-version selection, request options, idempotency keys, request IDs, pagination, and error handling as normal SDK usage. APICenter should provide shared timeout/abort, retry policy, request ID exposure, and explicit idempotency support where the gateway contract guarantees it. Do not retry non-idempotent actions unless the server supports an idempotency key. [Stripe server-side SDKs](https://docs.stripe.com/sdks/server-side?lang=node), [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- **A provider SDK is not automatically an application SDK pattern.** Twilio and Resend publish service-specific libraries; useful patterns include straightforward service verbs and explicit credentials, but APICenter is an internal API platform aggregating multiple shared services. Keep provider credentials and provider-specific payloads behind APICenter; expose APICenter’s stable contract, not a collection of vendor SDKs. [Twilio Node helper library](https://www.twilio.com/docs/libraries/reference/twilio-node/index.html), [Resend official SDKs](https://resend.com/docs/sdks), [Resend introduction](https://resend.com/docs/introduction)

## APICenter implications

> Historical baseline: the observations below describe the SDK and docs before the 2026-10-12 overhaul implementation. They are not the current SDK API.

At the time of review, `@alpha-explora/apicenter-sdk` documented `PaymentsClient`, `SharedServicesClient`, and `TribeClient`. The composite required both a payment API key and a shared-service token. Shared service operations were flat methods such as `emailSend`, `smsSend`, `otpGenerate`, and `geoGeocodeAddress`, while the payment and shared-service clients implemented their own request code. See the [package README](../../packages/sdk/README.md) and [public exports](../../packages/sdk/src/index.ts) for the historical surface; the legacy implementation files were removed in the overhaul.

The two clients duplicate fetch, authorization-header, envelope-parsing, and error-conversion logic. `ApiCenterError` lives in the payment implementation, and the shared-service implementation imports it from there. Both clients allow a custom `fetch` and per-request abort signal, but neither has shared timeout or retry settings, and the response parser does not expose the gateway correlation ID.

This makes callers learn both the product hierarchy and credential split, while service operations lack a consistent resource namespace. A caller who only needs email should not need to model payments or possess a payment key. The credential should select the caller's authorized organization and service placement. Calls should not accept caller-supplied org, tribe, or project headers when the token already binds that context.

The current token endpoint accepts `serviceId`, `environment`, and that service's secret. APICenter resolves the service's placement, then returns a bearer token whose identity includes the service, project, and tribe. The response can include a refresh token, and the gateway has a refresh route, but the SDK only accepts an already-issued static `serviceToken`. The token response DTO does not include an organization ID. Payment routes accept configured `apic_` keys and also pass other bearer tokens through JWT authentication; payment access still depends on the issued scopes. See the [token controller](../../apps/gateway/src/domains/auth-security/auth/auth.controller.ts), [token request](../../apps/gateway/src/shared/dto/token-request.dto.ts), and [payment auth guard](../../apps/gateway/src/domains/payments/shared/payment-auth.guard.ts).

At the time of review, the shared-service path worked on its own. A consumer could mint a service token through `/api/v1/auth/token`, pass it to `SharedServicesClient`, then call email, SMS, OTP, geo, or Google Auth methods. It did not need `TribeClient` or a payment key for this. The missing part was a consistent, documented setup that handled token lifetime and reflected the organization's access model.

The docs also drifted at the time of review. The root README showed the old `TribeClient` options and top-level service methods, while one client exposed `client.shared.*`. Generated API snippets imported the non-exported `@apicenter/sdk` package and `ApiCenterClient`. The SDK README and Fumadocs guide showed newer client classes, but still made consumers obtain and manage the shared-service token themselves. See the [root README](../../README.md), [SDK guide](../../apps/docs/content/docs/sdk-usage.mdx), [Vercel-style API snippet](../../apps/docs/components/vercel-api-doc.tsx), and [API layout snippet](../../apps/docs/components/api-doc-layout.tsx).

The package publishes to restricted GitHub Packages. Consumers need the `@alpha-explora` registry mapping and a GitHub token with `read:packages`. That can work for organization members who already have package access, but the install step needs to be part of the onboarding guide. See the [package metadata](../../packages/sdk/package.json) and [install instructions](../../packages/sdk/README.md).

## Recommended direction

1. **Make `ApiCenter` the one client users learn.** Construct it with the gateway URL and an explicit credential provider. In the first version, that provider can use the current registered-service credentials to issue and refresh scoped bearer tokens; future organization-level credentials can fit behind the same provider when APICenter supports them. Provide `client.email`, `client.sms`, `client.otp`, `client.geo`, `client.googleAuth`, and `client.payments`. Each namespace should expose the operations supported by the live gateway contract. Future org-shared APIs can add a namespace without changing client setup.
2. **Keep configuration predictable.** Do not require payment credentials just to use messaging or geo. Prefer the service bearer when it has the required scope, and support a payment API key only as an explicit alternate credential where needed. Hide token issue, refresh, and transport details behind the credential provider instead of making every consumer manage them by hand.
3. **Use one transport and one contract source.** Centralize base URL normalization, auth injection, fetch injection, abort/timeout handling, JSON parsing, envelope validation, error conversion, and request metadata. Derive service types from `packages/contracts` or generated OpenAPI where complete; add contract validation so manually authored public SDK types cannot silently drift. Keep service namespaces thin wrappers over this transport.
4. **Choose one public interface style and retire aliases deliberately.** Prefer discoverable noun namespaces (`client.email.send(...)`) and consistent verb conventions (`send`, `getStatus`, `generate`, `verify`, `geocode`, etc.). This repository has no SDK consumers outside the monorepo for this release, so migrate its callers together and remove the old exports instead of retaining compatibility aliases.
5. **Document the first useful journey before adding more operations.** A new consumer should be able to install, configure one token, send an email or SMS, generate or verify an OTP, geocode, and create a payment with typed examples. The guide should explain environments, scopes, errors, and whether a credential is safe in browser code. Keep provider secrets server-side and make the Node-only boundary explicit where a credential can authorize mutations.
6. **Treat reliability features as contract-bound.** Add request IDs and idempotency options only where the gateway exposes them; retry only safe/idempotent failures with bounded backoff. Include pagination and status polling only where the underlying API offers those operations. The SDK must not imply that a service feature works merely because its type exists.

## Implemented first-release shape

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
  { to: "person@example.com", subject: "Welcome", text: "Hello" },
  { idempotencyKey: randomUUID() },
);
await apicenter.otp.generate(
  { recipient: "person@example.com", channel: "email", purpose: "login" },
  { idempotencyKey: randomUUID() },
);
await apicenter.geo.geocodeAddress({ address: "Manila, Philippines" });
```

The example reflects the implemented package surface. Keep the service secret in a server environment. The package is prepared at version 2.0.0 but remains unpublished; use the package consumer fixture and contract checks when reviewing future interface changes. Record any unsupported or unverified methods explicitly.

## Source list

- Supabase JavaScript TypeScript support: https://supabase.com/docs/reference/javascript/typescript-support
- Supabase JavaScript Auth reference: https://supabase.com/docs/reference/javascript/auth
- Vercel SDK reference: https://vercel.com/docs/rest-api/sdk
- Stripe server-side SDKs, including Node.js setup, resource access, error behavior, request IDs, and `StripeClient`: https://docs.stripe.com/sdks/server-side?lang=node
- Stripe error object and HTTP status guidance: https://docs.stripe.com/api/errors
- Stripe idempotency: https://docs.stripe.com/api/idempotent_requests
- Twilio Node helper library: https://www.twilio.com/docs/libraries/reference/twilio-node/index.html
- Resend official SDK list: https://resend.com/docs/sdks
- Resend introduction and API-key/domain prerequisites: https://resend.com/docs/introduction
