---
title: APICenter domain layout and consumer access design
status: active
authority: informative
owner: platform-maintainers
audience: [maintainers, engineers, operators]
last_verified: unverified
verification: unverified
sources: [apps/gateway/src/main.ts, apps/gateway/src/domains/auth-security/auth/auth.controller.ts, apps/gateway/src/shared/proxy/cloud-run-auth.ts, apps/management/src/lib/server/api-center-admin.ts, packages/sdk/src/internal/transport.ts, infra/gcp/cloud-run/workspace]
---
# APICenter domain layout and consumer access design

## Approval and delivery status

The user approved the hostname layout and hosted access scope in conversation on 2026-10-12, then approved the execution plan and native execution in this chat. They explicitly require consumer applications on any hosting platform, including local backends, to connect using APICenter credentials. A separate local APICenter stack is not part of this rollout. Implementation is in progress; the dated domain rollout record tracks applied changes and pending acceptance evidence.

## Hostname ownership

| Hostname | Application | Authentication |
| --- | --- | --- |
| `apicenter.itsandbox.site` | Management console | Existing organization Google sign-in and management authorization |
| `api.apicenter.itsandbox.site` | Gateway consumer API and provider callbacks | APICenter service credentials, scoped access tokens, existing supported payment keys, or provider signatures as appropriate for the route |
| `docs.apicenter.itsandbox.site` | Developer documentation app | Public access, matching its current deployment posture |

The public docs assumption follows the existing app configuration and proposal. Documentation exposure does not grant API access. Organization, tribe, project, and service registry entries do not allocate hostnames. Email, SMS, OTP, Google Auth, geolocation, and payment runtimes retain private Cloud Run addresses and IAM invocation requirements.

These are canonical product addresses. Naming the Management console does not change its environment: the recorded deployment is `apicenter-management-test`. This change does not create a live Management instance or a separate test gateway. Existing test/live credentials and routing remain the environment boundary; separate deployments require separate review.

## Consumer and internal request flows

1. A local or hosted application backend configures the SDK with `baseUrl: "https://api.apicenter.itsandbox.site"` and its registered service ID, environment, and secret.
2. The SDK sends that credential to `/api/v1/auth/token` and handles access-token refresh internally.
3. The gateway validates active placement, environment, permissions, and quotas before accepting shared-service requests.
4. The gateway calls private runtimes using Google identity and the existing trusted APICenter principal handling.

Consumer requests through the API hostname require no Google Cloud account, Cloud Run invoker role, downloaded Google key, VPN, or platform-specific identity token. A credential grants only its registered permissions. The SDK remains a server-side client: application browser code calls its own backend rather than embedding the service secret.

Management backend calls may retain the private gateway `run.app` URL and Google identity authentication if that remains supported by the chosen ingress configuration. Preserve internal invocation when restricting ingress; being hosted on Cloud Run alone does not establish internal network eligibility. Confirm the actual networking path before changing ingress.

Provider webhook routes authenticate using their existing provider signature mechanisms. Do not add a service-credential requirement that providers cannot satisfy. Verify the Google Auth consumer flow before updating callback URLs; a browser redirect cannot carry a backend service secret, and a protected shared-service path is not automatically a valid public callback route.

## HTTPS and cloud boundary

Use a global external Application Load Balancer with hostname rules for the three apps and certificates explicitly covering all three full hostnames. A certificate covering `*.itsandbox.site` alone does not cover the nested API/docs names. Keep gateway invocation through the public load balancer compatible with organization policy; avoid granting public invocation to the private runtimes.

The intended gateway posture allows the load balancer to reach it without consumer Google IAM authentication while the gateway enforces application authorization. The repository describes an older approved combination of load-balancer-only ingress and disabled gateway Invoker IAM checks. That record is not proof of the current project's policy or ownership. Inventory and evaluate the live resources before selecting the exact settings.

Review every gateway controller's authentication before enabling consumer access. Service credentials must not authorize management, registry writes, credential provisioning, or platform administration. Health endpoints, token issuance, and provider-signed callbacks have their documented authentication semantics; all other protected endpoints retain their existing guards.

## Configuration and compatibility

- Update maintained SDK examples, onboarding snippets, gateway URL defaults, docs API examples, and public contract server URLs where applicable to the canonical API hostname. Preserve dated operational evidence as historical records.
- Configure Management's canonical origin and existing Google OAuth client's authorized JavaScript origins for `https://apicenter.itsandbox.site`. Preserve the currently used localhost development origin and verified redirect behavior.
- Update gateway browser-origin settings only for actual browser callers. Server-side SDK requests from localhost do not require adding every consumer hosting domain to CORS.
- Update configured webhook URLs and any verified OAuth redirect URLs with the providers, preserving provider signature verification and environment separation.
- Keep `api-center.itsandbox.site` as an API compatibility alias to the same gateway during the transition if ownership and live routing permit. Do not use a browser-style redirect for POST requests, credential exchange, or signed webhooks.
- No extra localhost DNS record is required. A local backend uses the same hosted API hostname and a test credential. Running the whole platform locally remains an independent existing development workflow.

## Inventory evidence and prerequisites

On 2026-10-12, public resolver queries returned `136.68.196.7` for `api-center.itsandbox.site` and `8.232.59.147` for `apicenter.itsandbox.site`. Proposed API/docs names and an unrelated probe hostname also returned the latter address, suggesting wildcard/default DNS behavior rather than proving an application mapping. The domain's authoritative nameservers are Cloudflare nameservers.

Live Cloud Run, URL-map, and HTTPS-proxy inventory could not refresh Google CLI credentials. Local HTTPS probes failed during TLS negotiation and did not establish current application routing or health. The saved deployment files and dated records are useful inputs but must be reconciled with a fresh authenticated inventory. Existing Terraform ownership is also recorded as unreconciled; do not apply Terraform against an assumed state.

Before implementation, establish the current GCP resource ownership, DNS editing access, certificates, and organization policy. Record the prior DNS, load balancer rules, ingress, invocation settings, and provider callback configuration for rollback. An existing load balancer can be reused only after its current host rules and ownership are confirmed.

## Acceptance criteria for the eventual implementation

- Each hostname has valid HTTPS and routes to its assigned app; existing unrelated host rules remain intact.
- A local backend with no Google identity can exchange a valid test credential and make an authorized shared-service request through the API hostname. Repeat from a non-GCP deployment.
- Invalid or revoked credentials fail, and a valid credential lacking permission cannot access the requested API or management operations.
- Management Google sign-in and session handling work at its canonical hostname and existing local development origin.
- Developer docs render at their hostname and show the canonical API URL.
- Runtime URLs remain inaccessible to unauthenticated callers; gateway and authorized internal calls continue to reach them.
- Provider-signed callbacks reach their gateway route and invalid signatures fail. Delivery/payment actions require an explicit safe test scope before they are exercised.
- Test/live credentials retain their isolation. Mapping hostnames alone is not evidence of environment isolation.
- Compatibility alias requests preserve methods, request bodies, and webhook signature behavior where the alias is retained.

Repository checks do not verify these cloud or provider outcomes. Record implementation and verification separately, including any pending OAuth, webhook, identity, or infrastructure ownership work. Retire this working spec's navigation entry after promoting the completed configuration and verified operating procedure into maintained documentation.
