---
title: APICenter hosted access and hostname ownership
status: canonical
authority: operational
owner: platform-operators
audience: [operators, engineers]
last_verified: "2026-10-12"
verification: runtime
sources: [infra/gcp/domains/apicenter-hostnames.json, infra/gcp/domains/apicenter-url-map.json, infra/gcp/domains/gateway-browser-origins.json, infra/gcp/cloud-run/workspace/apicenter-management-test.json, infra/gcp/cloud-run/workspace/apicenter-api-gateway-live.json, packages/sdk/README.md]
---
# APICenter hosted access and hostname ownership

## Addresses

| Address | Purpose |
| --- | --- |
| `https://apicenter.itsandbox.site` | Management console; organization Google sign-in and application access checks |
| `https://api.apicenter.itsandbox.site` | Gateway; APICenter consumer authentication and signed provider callback routes |
| `https://docs.apicenter.itsandbox.site` | Public developer guides and API reference |
| `https://api-center.itsandbox.site` | API compatibility alias; same gateway host rule, without a redirect |

The Management deployment is still `apicenter-management-test`. Its hostname does not promote it into a separate live Management environment. Gateway test/live grants and runtime routing remain the environment boundaries.

Organization, tribe, project and service registration do not allocate DNS records. Consumer applications host their own frontend/backend addresses. The APICenter SDK runs on their backend and connects to the canonical API URL using a registered service ID, environment and secret. A backend on localhost uses the same hosted API URL and a test credential. It does not need a Google Cloud account, Google identity token, VPN, local APICenter deployment, or dedicated APICenter subdomain.

## Request boundaries

The global HTTPS load balancer routes each hostname to its designated Cloud Run service. It covers the exact nested API/docs hostnames in a managed certificate. Cloudflare publishes DNS-only A records to the global address; do not turn on proxying without checking certificate issuance, provider signatures, and the chosen edge architecture.

The gateway uses `internal-and-cloud-load-balancing` ingress and disables the Cloud Run invoker IAM check. APICenter route guards still validate credentials, permissions, service placement, environment and quotas. Administrative routes require the platform secret or administrative authorization. Health, credential exchanges and provider-signed webhook endpoints retain their route-specific behavior.

Shared runtime Cloud Run services retain invoker IAM checks. The gateway supplies Google identity when invoking those runtimes. Consumers call gateway routes rather than copying the runtime URLs into the SDK.

Management uses the canonical API URL from its backend. Its administrative secret remains a server secret binding. The browser calls Management's own API routes. Google sign-in's public client ID is embedded during the Next.js build; updating runtime environment variables alone does not replace that browser value.

The browser allowlist includes the canonical Management and docs origins and the previous Management origin. The docs sandbox is a browser caller. Server SDK calls do not require adding every consumer hostname to CORS. Never expose a service secret in browser code.

## Provider URLs

Provider callbacks must use the gateway's actual signed callback routes. The compatibility alias preserves existing URLs during migration. Do not redirect POST callbacks or credential requests to the new API hostname. Twilio signature validation also depends on the configured callback URL; change runtime validation settings and provider configuration together.

Consumer Google Auth redirects belong to the consumer application. Register that application's redirect URI in its project/environment Google sign-in settings. The backend calls APICenter to authorize and exchange the code. A bearer-protected shared-service route is not a universal browser callback.

## Gateway credential and database settings

Set `TRIBE_SECRET_GCP_PREFIX=api-center-service-secret-` on the gateway. The variable retains its historical name, but the value must match Management's per-service secret naming. An explicit Cloud Run value takes precedence over the older prefix in the gateway's bootstrap secret bundle. Each payload names its service and environment and stores credential hashes only.

`DATABASE_POOL_MAX` controls the gateway's PostgreSQL connection pool per instance. It defaults to two and must be a positive integer. The checked-in gateway manifest explicitly uses two. Include old and new revisions, maximum instance counts, local processes and other database clients when budgeting Supabase session-pooler capacity. Raising Cloud Run's instance limit without that calculation can prevent a new revision from starting.

## Configuration and rollout evidence

- [Hostname and service mapping](../../infra/gcp/domains/apicenter-hostnames.json)
- [URL map](../../infra/gcp/domains/apicenter-url-map.json)
- [Gateway browser origins](../../infra/gcp/domains/gateway-browser-origins.json)
- [Dated rollout, previous revisions, DNS values and remaining checks](apicenter-domain-rollout-2026-10-12.md)
- [Runtime infrastructure ownership](../deployment-cloud-run.md#ownership-and-iac-boundary)

The dated record identifies the deployed revisions and precise verification scope. Successful HTTPS and administrative access do not prove consumer SDK grants, interactive user sign-in, SMS/email delivery, payment processing, or signed provider callbacks. Complete those checks with an agreed credential and request scope before claiming that integration is verified.

The repository manifests describe manual runtime changes. They do not reconcile the recovered Terraform state. Refresh actual DNS, certificates, routing, ingress and revision traffic before changing or rolling back the deployment.
