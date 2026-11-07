---
title: Credential onboarding patterns across Supabase, Vercel, Stripe, Cloud Run, and Azure API Management
status: reference
authority: informative
owner: platform-maintainers
audience: [maintainers, engineers]
last_verified: "2026-10-12"
verification: repository
sources: [packages/sdk/src/ApiCenter.ts, packages/sdk/src/types.ts, packages/sdk/src/internal/transport.ts, packages/sdk/src/internal/auth/service-token-provider.ts, apps/gateway/src/domains/auth-security/auth/auth.controller.ts, apps/gateway/src/domains/catalog-registry/registry/service-secret-resolver.service.ts, apps/management/src/components/service-detail/tribe-secret-provision-card.tsx, apps/management/src/components/service-detail-client.tsx, apps/management/src/app/api/local/tribe-secrets/route.ts, apps/gateway/src/shared/proxy/cloud-run-auth.ts]
---
# Credential onboarding patterns across Supabase, Vercel, Stripe, Cloud Run, and Azure API Management

Research date: 2026-10-12. This note records provider-documented behavior and UX lifecycle. These providers expose different credential classes; the note does not select an APICenter design.

## Findings

| Provider and credential class | Isolation and permission unit | Setup and secret handling | Rotation, revocation, and environment |
| --- | --- | --- | --- |
| **Supabase project API keys**: publishable keys identify a public application component; secret keys identify backend components. | Keys belong to a Supabase project. Publishable keys rely on grants and RLS. Secret keys map to the elevated service_role that bypasses RLS; they do not offer per-API or per-table permission scopes. Supabase advises separate secret keys for backend components so each can rotate independently, but each key retains project-wide elevated privilege. [API keys](https://supabase.com/docs/guides/getting-started/api-keys) | Retrieve/create keys in Dashboard Settings → API Keys or through Management API. The Connect dialog provides project URL and publishable key. Secret keys belong only in controlled server components, never browser code, source, or chat. [API keys](https://supabase.com/docs/guides/getting-started/api-keys) | Create a replacement, update every component, confirm migration, then delete the old secret. Deletion is irreversible. New secret keys can coexist with legacy service_role keys until those are separately disabled. [API keys](https://supabase.com/docs/guides/getting-started/api-keys) |
| **Supabase Management API credentials**: operator or integration access for control-plane tasks. | This is distinct from a project API key sent by runtime code. The platform guide shows a bearer secret token managing projects and creating/revealing project API keys. [Supabase for Platforms](https://supabase.com/docs/guides/integrations/supabase-for-platforms) | A platform integration can automate project setup and key creation, reducing manual copy steps. The provisioning credential itself has a separate trust boundary and must be authorized to manage provider resources. [Supabase for Platforms](https://supabase.com/docs/guides/integrations/supabase-for-platforms) | The cited platform guide documents project-key creation/retrieval. It does not imply that a user's personal management token should become an application runtime credential. |
| **Vercel account Access Tokens**: operator/API-management credential. | Created by an account user and scoped to the full account, one team, or one project. It authorizes Vercel REST API and CLI requests for resources available to that scope; it is not automatically a runtime identity for one deployed workload. [Access token guide](https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token) | Dashboard flow: account Settings → Tokens, descriptive name, choose scope and expiration, create, then copy once and store in a secret manager or environment variable. A lost token requires replacement. [Access token guide](https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token) | Expiration and scope affect access. Dashboard deletion or CLI removal revokes a token; distribute its replacement before deleting one still in use. [Access token guide](https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token) |
| **Vercel delegated OAuth tokens**: Sign in with Vercel authorization. | ID token proves user identity but does not grant Vercel resource access. OAuth access token authorizes configured resources on the user's behalf. [Tokens](https://vercel.com/docs/sign-in-with-vercel/tokens) | The app declares scopes; user sees a consent page and chooses whether to grant them. Access token lasts one hour. Optional refresh token lasts 30 days, is single-use, and rotates on exchange. Tokens must be kept server-side. [Tokens](https://vercel.com/docs/sign-in-with-vercel/tokens), [Manage Sign in with Vercel](https://vercel.com/docs/sign-in-with-vercel/manage-from-dashboard) | Vercel documents revocation through a revoke endpoint or invalidating the app's tokens in the dashboard. [Tokens](https://vercel.com/docs/sign-in-with-vercel/tokens) |
| **Vercel OIDC federation**: deployed-workload identity. | Vercel signs identity tokens tied to project/deployment context. Cloud providers can grant access differently by project or environment. This is exchanged for short-lived credentials, not a persistent cloud API key. [OIDC Federation](https://vercel.com/docs/oidc) | Token is provided in build/function context; local development can pull a development token using Vercel CLI. Configure a cloud provider to trust issuer/claims and exchange the token, avoiding long-lived cloud credentials in environment variables. [OIDC Federation](https://vercel.com/docs/oidc) | Tokens expire and the platform supplies renewed tokens. Receiver trust policy controls resulting permissions. Exact lifetimes depend on the execution context and are not a requirement for APICenter. [OIDC Federation](https://vercel.com/docs/oidc) |
| **Stripe API keys**: publishable, unrestricted secret, or restricted API key (RAK). | Keys are tied to the account or sandbox. Publishable keys are for client code and cannot perform sensitive server operations. Secret keys are unrestricted. RAK permissions are configurable; Stripe supports separate keys for different application parts. RAKs remain backend secrets. [API keys](https://docs.stripe.com/keys), [Restricted API keys](https://docs.stripe.com/keys/restricted-api-keys) | Dashboard API keys page creates keys. A live key created by the user is displayed once; save it in a secrets vault or server environment. Stripe recommends RAKs for most server use cases and only granting required permissions. [API keys](https://docs.stripe.com/keys) | Dashboard rotation makes a replacement; old and new keys can both work for up to seven days for gradual rollout. A key can be expired/replaced if lost or compromised. Sandbox and live modes have separate keys and isolated objects. [API keys](https://docs.stripe.com/keys) |
| **Google Cloud Run service identity**: workload identity, not a copied provider API key. | Each Cloud Run service can use a service account; IAM grants permissions to that identity. For private Cloud Run-to-Cloud Run calls, the receiving service grants roles/run.invoker to the caller identity. Google recommends per-service identities with least privilege. [Service identity](https://docs.cloud.google.com/run/docs/securing/service-identity), [Service-to-service authentication](https://docs.cloud.google.com/run/docs/authenticating/service-to-service) | Cloud Run obtains credentials through Application Default Credentials and its metadata server. A caller gets a Google-signed OIDC ID token whose audience is the receiving service URL or configured audience. This flow does not require copying a service-account private key into the running service. [Service identity](https://docs.cloud.google.com/run/docs/securing/service-identity), [Service-to-service authentication](https://docs.cloud.google.com/run/docs/authenticating/service-to-service) | ID tokens expire at approximately one hour; metadata retrieval returns a valid token. Google warns that service-account keys are a security risk and recommends alternatives when possible. [Service-to-service authentication](https://docs.cloud.google.com/run/docs/authenticating/service-to-service) |
| **Azure API Management subscriptions**: API/product access entitlement. | A subscription can be scoped to all APIs, one product, or one API. It grants access according to that subscription scope and associated subscription policies; Microsoft recommends pairing subscription keys with another authentication method. The key is an API entitlement, not by itself proof of a unique workload identity. [Subscriptions](https://learn.microsoft.com/en-us/azure/api-management/api-management-subscriptions), [Authentication and authorization](https://learn.microsoft.com/en-us/azure/api-management/authentication-authorization-overview), [Key concepts](https://learn.microsoft.com/en-us/azure/api-management/api-management-key-concepts) | Publishers can create subscriptions directly; consumers typically request through the developer portal or receive them from publishers. Product requests can be auto-approved or require publisher approval. A standalone subscription can be shared among developers or teams, but cannot be directly assigned to Entra ID groups. [Create subscriptions](https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-create-subscriptions), [Subscriptions](https://learn.microsoft.com/en-us/azure/api-management/api-management-subscriptions) | Each subscription has primary and secondary keys for a manual staged swap: regenerate one, update clients, then regenerate the other. APIM has no built-in key expiration or automatic rotation. A subscription can be suspended, cancelled, or deleted. [Subscriptions](https://learn.microsoft.com/en-us/azure/api-management/api-management-subscriptions) |

## Cross-provider UX observations

- Some providers make the user copy a newly created secret once, then place it in a secret manager (Stripe live keys and Vercel account Access Tokens). [Stripe API keys](https://docs.stripe.com/keys), [Vercel access token guide](https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token)
- An authorized provider integration may provision runtime keys through its control plane, but that management authorization is a distinct credential and trust boundary (Supabase for Platforms). [Supabase for Platforms](https://supabase.com/docs/guides/integrations/supabase-for-platforms)
- Workload identity federation avoids a persistent cloud key when issuer and receiver support a trust relationship. Trust configuration and short-lived token renewal take the place of copying a key. [Vercel OIDC](https://vercel.com/docs/oidc), [Cloud Run service-to-service authentication](https://docs.cloud.google.com/run/docs/authenticating/service-to-service)
- Rotation behavior varies: Supabase documents replacement and then deletion; Stripe permits up to seven days of overlap; Azure APIM subscriptions have primary and secondary keys; OIDC obtains short-lived tokens and changes access through IAM/trust policy. [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Stripe API keys](https://docs.stripe.com/keys), [Azure APIM subscriptions](https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-create-subscriptions), [Vercel OIDC](https://vercel.com/docs/oidc)
- Environment boundaries may use separate projects, sandbox/live key pairs, or identity claims and trust policy. Stripe explicitly isolates sandbox and live data; Vercel documents project/environment-granular OIDC grants. [Stripe API keys](https://docs.stripe.com/keys), [Vercel OIDC](https://vercel.com/docs/oidc)

## Decision criteria and open questions (no selection)

1. Is a credential for a human managing a provider account, an application component calling a provider API, or a workload proving identity? What separate setup and storage flows are required?
2. What is the smallest enforced permission unit: account, project, resource, API operation, service, product, or environment? Which boundary is only a label?
3. Can an approved provider flow provision credentials, or must a user create and paste them? What permissions does the provisioning credential itself hold?
4. Is a secret recoverable after creation? If it is one-time display, does UX explain secure storage and recovery before the user leaves?
5. Can each runtime component have an independent credential? Does that credential have narrower permissions, or is it an independently revocable copy of broad access?
6. Can rotation overlap old/new credentials? Can consumers move before revocation, and can a console show last-used or health evidence without revealing the value?
7. How are test and production isolated: provider accounts/projects, key modes, scopes, environment claims, or application labels? Does changing a label change authorization?
8. Can a deployment platform obtain short-lived identity through OIDC or managed identity? What issuer, audience, environment, and local-development trust setup is required?
9. Which lifecycle states can be backed by provider evidence: pending, active, expiring, rotation pending, revoked, misconfigured, last verified?
10. Which actions need explicit approval because they grant broad access, affect production, or replace a credential? How can UX state their blast radius?

## APICenter source-of-truth review

The following observations come from the current workspace source, including its existing uncommitted changes. They describe implementation, not a new deployed runtime check.

### Credential count and purpose

One configured `ApiCenter` creates one transport used by its `email`, `sms`, `otp`, `geo`, `googleAuth`, and `payments` namespaces. The same caller credential can cover every permitted namespace. A consumer does not need a separate APICenter secret for each shared API. [SDK entry point](../../packages/sdk/src/ApiCenter.ts)

The credential resolver binds a secret to one registered calling service and one environment. Its Secret Manager payload must name that service and environment. If S calling services all use both test and live, this model has 2S logical caller credentials; API count and replica count do not multiply that requirement. Additional rotation versions are part of a credential's lifecycle. Platform provider secrets, the package registry read token, and human Management sign-in are different credential categories. [Credential resolver](../../apps/gateway/src/domains/catalog-registry/registry/service-secret-resolver.service.ts), [SDK configuration](../../packages/sdk/src/types.ts)

Payment API keys are an optional alternate authentication path in the SDK. Payment requests use an explicit payment key when configured, otherwise service authentication. The SDK permits payment-only configuration with no service credential. These keys should therefore be counted separately from the shared caller credential rather than presented as mandatory setup for every shared API. [Transport](../../packages/sdk/src/internal/transport.ts), [SDK configuration](../../packages/sdk/src/types.ts)

### Onboarding and access enforcement

Management generates a plaintext secret and SHA-256 hash in browser memory. The user separately generates, provisions, and copies it. The provisioning endpoint authorizes the operator and writes the hash payload to Google Secret Manager. The card displays the storage object name, hash, operation preview, and rotation details. These are observable UI steps; their usability has not been measured with a user study. [Generation and provisioning](../../apps/management/src/components/service-detail-client.tsx), [Credential UI](../../apps/management/src/components/service-detail/tribe-secret-provision-card.tsx), [Provisioning endpoint](../../apps/management/src/app/api/local/tribe-secrets/route.ts)

The gateway validates the service/environment secret before issuing a service token. It checks active placement and derives project, tribe, permissions, and callable-service scopes from the registry. Shared platform runtime entries cannot mint these caller tokens. Refreshing a token rechecks active placement and recalculates the grant. [Token endpoint](../../apps/gateway/src/domains/auth-security/auth/auth.controller.ts)

The SDK obtains and refreshes service tokens internally. It already supports an `AccessTokenProvider.getAccessToken()` alternative, so the SDK has an extension point for a different token source. This interface alone does not establish gateway trust in an arbitrary Google or Vercel token. [Token provider](../../packages/sdk/src/internal/auth/service-token-provider.ts), [Authentication interface](../../packages/sdk/src/types.ts)

Google service identity is already used for the gateway's outbound requests to private Cloud Run runtimes when enabled. That protects the gateway-to-runtime connection. The inspected consumer token issuance endpoint still requires its registered service secret. A consumer workload identity flow would need verified issuer/audience/subject handling and a mapping to APICenter's registered service/environment before registry authorization could be applied. This last point is an architectural inference, not an implemented capability. [Cloud Run upstream authentication](../../apps/gateway/src/shared/proxy/cloud-run-auth.ts), [Token endpoint](../../apps/gateway/src/domains/auth-security/auth/auth.controller.ts)

### What the comparison leaves open

The provider evidence exposes separate decisions rather than one universal key count:

- Caller identity granularity determines whether revocation, audit attribution, scopes, and quota ownership can distinguish services within a project.
- Issuance and storage UX determines how many manual actions a team performs. Automating those actions does not itself require sharing one credential among callers.
- Workload identity replaces a persistent secret with issuer trust, identity binding, and token renewal where the hosting platform supports it.
- API access subscriptions determine which APIs a caller may consume. Azure APIM shows that this entitlement can be managed separately from caller authentication.
- Local development and callers on other hosting platforms need an explicit onboarding path even if a hosted identity flow exists.

No option is ranked or selected here. The user-provided rollout constraint is that there are currently no SDK consumers outside this repository; no external consumer inventory was independently audited for this note.

## Evidence limits

- This review uses public first-party documentation as accessible on 2026-10-12. Dashboard labels, plan gating, APIs, and provider lifecycle behavior can change.
- Vercel account Access Tokens, delegated OAuth tokens, and OIDC workload tokens are separate flows; stated scopes and lifetimes apply only to the named flow.
- Supabase project secret keys have project-wide elevated service_role permissions. Different key names/component ownership allow independent rotation but do not provide per-key API-operation scopes in the cited documentation.
- Cloud Run service identity applies to workloads on Google Cloud; it does not automatically supply identity to arbitrary external runtimes.
- Azure API Management subscriptions grant API/product scope but are not equivalent to a cryptographic identity assertion from a distinct workload.
- Provider docs describe vendor capabilities, not their suitability, availability, or implementation cost in APICenter.

## Sources reviewed

- Supabase API keys: https://supabase.com/docs/guides/getting-started/api-keys
- Supabase for Platforms: https://supabase.com/docs/guides/integrations/supabase-for-platforms
- Vercel account Access Token setup and scope: https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token
- Vercel Sign in with Vercel tokens: https://vercel.com/docs/sign-in-with-vercel/tokens
- Vercel OAuth app setup and permissions: https://vercel.com/docs/sign-in-with-vercel/manage-from-dashboard
- Vercel OIDC Federation: https://vercel.com/docs/oidc
- Stripe API keys: https://docs.stripe.com/keys
- Stripe restricted API keys: https://docs.stripe.com/keys/restricted-api-keys
- Cloud Run service identity: https://docs.cloud.google.com/run/docs/securing/service-identity
- Cloud Run service-to-service authentication: https://docs.cloud.google.com/run/docs/authenticating/service-to-service
- Azure API Management subscription guide: https://learn.microsoft.com/en-us/azure/api-management/api-management-howto-create-subscriptions
- Azure API Management authentication and authorization: https://learn.microsoft.com/en-us/azure/api-management/authentication-authorization-overview
- Azure API Management key concepts: https://learn.microsoft.com/en-us/azure/api-management/api-management-key-concepts
- Azure API Management subscriptions and key lifecycle: https://learn.microsoft.com/en-us/azure/api-management/api-management-subscriptions
