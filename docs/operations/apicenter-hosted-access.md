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

## Regions

The Supabase database is in `ap-southeast-2` (Sydney). Since 2026-11-20 the services that query it run beside it in `australia-southeast1`: the gateway (`apicenter-api-gateway-live`), the console (`apicenter-management-test`), and the email, SMS, OTP, Google sign-in, geolocation and payments runtimes. Every request queried the database across regions before, and a console page made about a hundred such round trips.

Two services stay in `asia-southeast1`. The docs site has no database. The webhooks runtime keeps its URL because each webhook destination's Pub/Sub push subscription points at it; it writes delivery history asynchronously. The payment-event dispatcher jobs also stay there. Images remain in the `asia-southeast1` Artifact Registry.

The load balancer has one serverless network endpoint group per backend: `apicenter-gateway-neg-syd` and `apicenter-management-neg-syd` in `australia-southeast1`, and `apicenter-docs-neg` in `asia-southeast1`. Deploy with `--region australia-southeast1` for the moved services. The gateway's `SHARED_SERVICE_ROUTE_*` values name the runtimes' `australia-southeast1` URLs.

To move a backend between regions, attach the new region's endpoint group next to the old one and wait until it serves; changes took several minutes to reach the load balancer's proxies. Traffic always goes to the nearest healthy region, and the capacity scaler does not steer serverless backends, so the switch is detaching the old group. Make that change as a single `backend-services export`/`import`, and keep the two-region file to re-import if requests fail. A backend accepts only one serverless endpoint group per region.

## Building and deploying images

Build every image from a clean checkout of the commit you are releasing:

```bash
gcloud builds submit --region asia-southeast1   --config infra/gcp/cloud-build/apicenter-workspace-images.json   --substitutions=_GOOGLE_CLIENT_ID=<console OAuth client ID>,_RELEASE_SHA=$(git rev-parse HEAD)
```

The build compiles every app once in one `builder` stage on an `E2_HIGHCPU_8` worker (8 vCPUs, 8 GB; at most four app builds at once to stay within memory; `E2_HIGHCPU_32` is not allowed by the project's Cloud Build quota in `asia-southeast1`). Each image then copies from that stage, so all images share one identical `node_modules` layer. The gateway is pushed first and the other images reuse its layers. Before 2026-11-25 each app was built and pruned separately on the default 2-vCPU worker, and the build took about 50 minutes, 22 of them pushing images.

`_RELEASE_SHA` is baked into each image as `APICENTER_RELEASE_SHA`, which `/api/v1/health/ready` reports. Do not set that variable on a Cloud Run service; it would override the image's value and go stale. Deploy each service with `gcloud run services update <service> --region <region> --image <image>:build-<id> --revision-suffix <tag>`, then route traffic with `update-traffic --to-revisions <service>-<tag>=100`, because traffic is often pinned to a named revision. Deploy runtimes before the gateway when a release changes what the gateway signs.

## Gateway credential and database settings

Set `TRIBE_SECRET_GCP_PREFIX=api-center-service-secret-` on the gateway. The variable retains its historical name, but the value must match Management's per-service secret naming. An explicit Cloud Run value takes precedence over the older prefix in the gateway's bootstrap secret bundle. Each payload names its service and environment and stores credential hashes only.

`DATABASE_POOL_MAX` controls the gateway's PostgreSQL connection pool per instance. It defaults to two and must be a positive integer. The checked-in gateway manifest uses four and keeps one instance warm (`minScale` 1), because two connections could not serve one console page load while the gateway ran in `asia-southeast1`, a region away from the database. The gateway now runs next to the database (see Regions). At three instances that is twelve connections. Include old and new revisions, maximum instance counts, local processes and other database clients when budgeting Supabase session-pooler capacity. Raising Cloud Run's instance limit without that calculation can prevent a new revision from starting.

## Configuration and rollout evidence

- [Hostname and service mapping](../../infra/gcp/domains/apicenter-hostnames.json)
- [URL map](../../infra/gcp/domains/apicenter-url-map.json)
- [Gateway browser origins](../../infra/gcp/domains/gateway-browser-origins.json)
- [Runtime infrastructure ownership](../deployment-cloud-run.md#ownership-and-iac-boundary)

The dated record identifies the deployed revisions and precise verification scope. Successful HTTPS and administrative access do not prove consumer SDK grants, interactive user sign-in, SMS/email delivery, payment processing, or signed provider callbacks. Complete those checks with an agreed credential and request scope before claiming that integration is verified.

The repository manifests describe manual runtime changes. They do not reconcile the recovered Terraform state. Refresh actual DNS, certificates, routing, ingress and revision traffic before changing or rolling back the deployment.

## Review and apply this configuration

These checked-in deployment records describe the dated rollout, not a new deployment verification. Preserve the service and revision scaling limits already on main. The eight workspace service manifests already exist on main and are retained unchanged; historical local exports omitted the newer service-level cap. Review runtime ownership, current image digests, IAM, ingress, routes and secret-version references before applying any manifest. The payment YAML keeps the main image reference instead of the older snapshot build; replace it with the reviewed release digest through the deployment pipeline.

This change depends on the console registration/OAuth PR. Apply the separate runtime-authentication and database-resilience changes before treating the full hosted onboarding flow as ready. No DNS, IAM, billing, database or service deployment is performed by this PR.

## Payment ingress policy and observed drift

The payment manifests retain main's `internal` ingress policy. Provider webhooks enter the public gateway at `/api/v1/shared/payment/webhooks/test` or `/live`; the gateway verifies signatures and forwards with runtime identity. Payment runtimes are not load-balancer backends in the checked-in hostname map.

A read-only Cloud Run/IAM refresh on 2026-11-07 found payment service ingress set to `all`, while the payment and shared runtimes had no public invoker binding and did not disable invoker IAM. That is network-policy drift, not proof of anonymous access. This repository change does not modify those live services. Before applying manifests, verify the gateway-to-runtime VPC path under internal ingress and keep webhook delivery through the gateway. Live routing and certificate control-plane checks are separate from this Cloud Run evidence.

The same read-only refresh found test database secret version 3 destroyed and version 4 enabled. The current test payment service references version 4; the test manifest already matched that enabled reference, so no reference change was needed. Live database version 3 was enabled. Only version metadata and references were read, not secret payloads; no secret version or service was modified.

The URL map and certificate were also read on 2026-11-07 using the already-authorized abtorres.it account. The apicenter-hosted-apps host rules matched the Management, gateway (including the old API alias) and docs configuration, and apicenter-hosted-domains was ACTIVE for all four exact hostnames. DNS resolved the three canonical names to the same address. No IAM grant, route, certificate or DNS change was made. These reads do not verify an interactive sign-in or a provider action.
