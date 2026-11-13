---
title: APICenter hosted domain rollout - 2026-10-12
status: active
authority: operational
owner: platform-operators
audience: [operators, engineers]
last_verified: "2026-10-12"
verification: runtime
sources: [infra/gcp/domains/apicenter-hostnames.json, infra/gcp/domains/apicenter-url-map.json, infra/gcp/cloud-build/apicenter-hosted-web-images.json, apps/gateway/src/domains/auth-security/auth/auth.controller.ts, apps/management/src/lib/server/api-center-admin.ts]
---
# APICenter hosted domain rollout - 2026-10-12

The user approved this layout, hosted credential access from any platform including local backends, and native execution. This record separates applied configuration from pending delivery checks. No Terraform state was initialized or changed. The recovered runtime state remains unreconciled as described in [Cloud Run ownership](../deployment-cloud-run.md#ownership-and-iac-boundary).

## Applied cloud and DNS resources

Project `apicenter-alpha-20260623`, number `565306324295`, region `asia-southeast1`. Billing linkage was preserved.

Authenticated inventory found no existing load balancer addresses, forwarding rules, URL maps, HTTPS proxies, backend services, serverless NEGs, or Compute certificates. APICenter-specific resources were created manually:

| Resource | Name |
| --- | --- |
| Premium global IPv4 | `apicenter-https-ip`: `8.232.125.171` |
| Global external managed HTTPS frontend | `apicenter-https`, port 443 |
| HTTPS proxy | `apicenter-https-proxy` |
| URL map | `apicenter-hosted-apps` |
| Managed certificate | `apicenter-hosted-domains`, four exact hostname SANs |
| SSL policy | `apicenter-modern-tls`, MODERN, minimum TLS 1.2 |

| Hostname | Cloud Run service | Serverless NEG | Backend |
| --- | --- | --- | --- |
| `apicenter.itsandbox.site` | `apicenter-management-test` | `apicenter-management-neg` | `apicenter-management-backend` |
| `api.apicenter.itsandbox.site` | `apicenter-api-gateway-live` | `apicenter-gateway-neg` | `apicenter-gateway-backend` |
| `docs.apicenter.itsandbox.site` | `apicenter-developer-docs-live` | `apicenter-docs-neg` | `apicenter-docs-backend` |
| `api-center.itsandbox.site` | Same gateway, compatibility alias | Same gateway NEG | Same gateway backend |

Backends have CDN disabled. Serverless NEGs do not use health checks. The default host route points to docs. The API alias uses a host rule, preserving request methods and bodies without an HTTP redirect.

Cloudflare zone `itsandbox.site` had no explicit records for the three canonical names. They inherited the zone wildcard at `8.232.59.147`. Explicit A records now point to `8.232.125.171`, DNS only, TTL 300 seconds. The existing API alias A record changed from `136.68.196.7`, TTL Auto, to the same new IP and TTL 300. Other DNS records were preserved.

## Deployment access and retries

Google CLI authentication was refreshed for `abtorres.it@alphaexplora.com`. The user authorized granting that account project `roles/compute.loadBalancerAdmin`; the grant succeeded. The account also needed source-bucket metadata access for the authorized image build. A conditional `roles/storage.bucketViewer` binding permits only the bucket `projects/_/buckets/apicenter-alpha-20260623_cloudbuild`. Existing group permissions supplied source upload and Cloud Build access.

Initial Compute creation attempts were denied before the role grant. A later transient connection reset interrupted creation after the gateway backend was created. Inventory confirmed that backend existed, and execution resumed with attachment of its NEG. No duplicate backend was created. Source uploads initially failed; they succeeded after the bucket metadata grant propagated.

The additional operator bindings can be removed after rollout if temporary access is desired. Removing them is an operator decision; it does not alter application runtime identities.

## Authorization and application configuration

Source inspection confirmed JWT guards for shared-service, tribe, external, and developer-portal routes; administrative and registry routes use platform or scoped administrative guards. Payments use `PaymentAuthGuard`. Token issuance validates the service secret, active service environment, project and tribe placement. Refresh revalidates the grant. Intentional public exceptions are health and JWKS, credential/refresh exchanges, and provider-signed webhook endpoints. Resend, Twilio and PayMongo handlers validate signatures before forwarding.

At the start of rollout, the gateway had ingress `all` and required Cloud Run IAM. Management invoked its private `run.app` address using Google identity. The deployed gateway now has ingress `internal-and-cloud-load-balancing` with invoker IAM disabled, while APICenter route authorization remains enforced. Private shared runtimes retain IAM checks. Management's new revision uses the canonical API hostname and its existing server-only administrative secret.

SDK examples, active consumer guides, public contract server URLs, and Management defaults now use `https://api.apicenter.itsandbox.site`. The consumer runbook links to `https://docs.apicenter.itsandbox.site`. A local backend uses the hosted API and its APICenter test credential; its hostname does not need CORS registration. The SDK service secret remains on the consumer backend.

Cloud Build `c3285244-5af0-4473-8798-cf68be8e5bc1` succeeded, building Management and docs images with the existing deployer identity. Browser Google client ID is supplied at build time. Nested environment files and ignored `.codex/` local evidence are excluded from build uploads and Docker contexts.

| Service | Initial domain rollout revision | Image digest |
| --- | --- | --- |
| Management | `apicenter-management-test-00002-89d` | `sha256:aa1f21ccffdbbd1aa788252ffb654a2c5abdd077a58b3300a1ac34fa1b06e413` |
| Gateway, existing image with new configuration | `apicenter-api-gateway-live-00003-zl5` | Existing gateway image from the earlier workspace build |
| Docs, including redirect fix | `apicenter-developer-docs-live-00003-gqg` | `sha256:0001ac8925640518537f25bfc9c5f3befa361d90e516fb7191da32a98ec9a79f` |

The gateway browser allowlist retains its existing Management origin and adds the canonical Management and docs origins. The docs app has an interactive browser sandbox; its preflight returns the docs origin. Server SDK consumers need no CORS entry.

Opening a docs guide without its trailing slash exposed an nginx redirect to `http://docs.apicenter.itsandbox.site:8080/...`. Both docs Dockerfiles now use `docker/nginx.docs.conf` with `absolute_redirect off`, so nginx directory redirects retain the browser's public HTTPS origin. This follows the [nginx directive documentation](https://nginx.org/en/docs/http/ngx_http_core_module.html#absolute_redirect). Build `82109142-cecb-44d8-8413-9d03e0b11b69` succeeded and the fixed docs revision serves 100% of traffic. A fresh HTTPS request to `/guides/sdk-usage` returned a relative `Location: /guides/sdk-usage/`; following it returned 200. The guide rendered in the browser at its canonical trailing-slash URL and displayed the new API origin. The browser session retained the earlier permanent redirect for the slashless URL, so that cached navigation was not used as evidence of the new server response.

## Provider and OAuth gaps

- The gateway's existing secret bundle has test and live PayMongo webhook secrets. The compatibility API hostname is retained so configured old provider URLs can continue to use the same routes. Provider dashboard URL inventory and signed-event delivery have not been verified in this rollout.
- Twilio credentials and status callback URL are absent. Resend webhook secret is absent. Domain mapping does not configure these providers or prove callback delivery.
- Google Auth uses authenticated server calls to authorize and exchange a code. The consumer application's registered redirect URI receives the browser redirect. Do not register a bearer-protected gateway route as a universal public OAuth callback.
- Management's existing OAuth client is `565306324295-jaj3lkfq9t8577mmoicvdpe39iriu6u0.apps.googleusercontent.com`. After user browser verification, inspection confirmed `https://apicenter.itsandbox.site` was already present, along with `http://localhost`, `http://localhost:3001`, and the current hashed Management Cloud Run origin. No OAuth edit was needed. Interactive application sign-in was subsequently confirmed during Serbizio onboarding.

## Checks and remaining delivery

Passed: Management and docs typechecks, public contract validation, generated public contract JSON, documentation check, monorepo boundary checks, and `git diff --check`. Cloud Build built both apps successfully. Final live comparison confirmed saved app images, canonical URL variables, browser origins, ingress and invoker settings match the three deployed services; each recorded revision serves 100% of traffic. No test suite or provider action was run.

The managed certificate is ACTIVE for all four exact names. HTTPS requests with normal certificate validation returned 200 for Management sign-in, docs root, gateway liveness/readiness, and alias liveness. Readiness reported Redis up and six registered shared services. Anonymous registry and shared-service requests returned 401. A server administrative credential read the six registry entries through the public API with no Google identity token. Each of the seven runtime URLs rejected anonymous requests with 403; the gateway's direct Cloud Run URL returned 404 under the restricted ingress. Docs-origin CORS preflight returned 204 with the expected allow-origin header. Probes used IPv4 because the local resolver's synthesized IPv6 path reset before TLS; browser page loads and IPv4 TLS succeeded without bypassing certificate validation.

At the end of the initial domain rollout, interactive Management Google sign-in, signed provider callbacks, and token exchange plus a shared-service request using a registered consumer test credential from outside Google Cloud remained pending. Subsequent authorized Serbizio onboarding confirmed sign-in and token exchange as recorded below. Shared-service requests and signed provider delivery remain unverified. An administrative registry read does not establish consumer SDK permissions or provider delivery.

## Registration follow-up

The first consumer registration attempts exposed two existing form defects. Cloud Run logs for `POST /api/v1/registry/register` reported that the `staging` row violated `service_environments_environment_check`. Supabase inspection confirmed the same `test`/`live` constraint as the repository baseline. Source inspection confirmed token issuance, runtime routing and the SDK use these two environments. The form's staging/UAT/demo choices were therefore removed from new writes; legacy registry reads remain tolerant. No database constraint was widened and no database migration ran for this fix.

Selecting `live` exposed a second defect: Management requires the exact phrase `APPLY LIVE CHANGE` and a reason, but the registration form omitted those controls. The gateway also requires a matching approved request. The form now includes all three inputs and the client forwards confirmation separately from the manifest, preserving the gateway approval check. Local typechecks, contract validation, documentation checks and boundary checks passed.

Cloud Build `a1882fe5-be45-4714-98c8-b3a8ab320599` succeeded using `infra/gcp/cloud-build/apicenter-registration-fix-images.json`. The following revisions now serve 100% of traffic, preserving the existing environment, secret, ingress and IAM settings:

| Service | Current serving revision |
| --- | --- |
| Gateway, registration-form rollout | `apicenter-api-gateway-live-00004-zvt` |
| Management | `apicenter-management-test-00003-kjx` |
| Docs | `apicenter-developer-docs-live-00004-7qt` |

The existing signed-in Management tab rendered the updated test/live choices and all three live approval inputs. Its Serbizio draft was restored after refresh. HTTPS checks returned 200 for Management, docs and gateway liveness; anonymous registry access remained 401 and the private email runtime remained 403. No service registration, approval transition, consumer credential provisioning or provider action was exercised as a delivery check for that deployment.

## Authorized Serbizio onboarding

The user subsequently authorized registration and selected test access with a live approval request. Management's Google ID token had expired, so its registration attempt failed before reaching the gateway. The operator submitted the preserved manifest through the authenticated gateway API. Read-back and Supabase inspection confirmed service `serbizio`, project `serbizio`, active test environment, and backend `https://serbizio-backend.onrender.com`.

Live approval request `bc675260-6564-4ab0-ba18-623181628776` is pending for action `service.register_live`, target `serbizio`, environment `live`. Its actor is `platform-admin`, the gateway's identifier for the shared operator credential. An independently authenticated administrative actor must approve it. The request proposes retaining test and adding live; no live environment or live credential was issued.

The test credential hash was provisioned as version 1 of `api-center-service-secret-serbizio-test`. Only the gateway runtime identity received secret-level accessor permission. Token exchange initially returned 401 because the bootstrap bundle still configured the old `api-center-tribe-secret-` prefix. An explicit canonical prefix overrides that bundle value.

Configuration-only revision `apicenter-api-gateway-live-00005-mz6` failed startup with `(EMAXCONNSESSION) max clients reached in session mode`, reporting a pool size of 15. Revision `00004-zvt` retained all traffic. The gateway previously used node-postgres's default pool size per instance. Source now uses `DATABASE_POOL_MAX`, defaults to two, and rejects invalid values. The gateway manifest explicitly records two connections and the canonical credential prefix.

Cloud Build `2a30ee41-a860-45c5-bacf-f39d0c4c7da1` succeeded with gateway image digest `sha256:b2a45f84eab100639b9956396bfe62c607634000bab12af2a0098e121140c268`. The first deployment command reported the earlier failed revision because the desired traffic target still referenced `00005-mz6`. Explicitly routing to replacement revision `apicenter-api-gateway-live-00006-848` succeeded. All readiness conditions are true and it serves 100% of traffic.

The test credential exchange returned HTTP 201 with service `serbizio`, project `serbizio`, tribe `shoti`, environment `test`, and a one-hour token. Its scopes include the selected shared-service capabilities. Plaintext credentials and returned bearer tokens were not written to tracked files or displayed in chat. No shared-service sends, payment mutations or signed callbacks were exercised. Live request approval, live registration and a live credential remain pending.

After the user refreshed Google sign-in, the console showed full access for the existing operator and loaded Serbizio's active registry record, project, tribe and test endpoint. The summary reported unhealthy backend health and pending credential handoff. These observations do not invalidate the successful credential exchange or establish backend reachability; runtime health and consumer integration still need attention.

## Rollback inputs

| Service | Prior ready revision |
| --- | --- |
| Gateway | `apicenter-api-gateway-live-00002-zrl` |
| Management | `apicenter-management-test-00001-2fv` |
| Developer docs | `apicenter-developer-docs-live-00001-qjx` |

Before switching gateway ingress, record and preserve its IAM policy. To restore the prior access posture, enable invoker IAM and set ingress back to `all`. Restore Management server `API_CENTER_BASE_URL` to `https://apicenter-api-gateway-live-mvrs6gmtgq-as.a.run.app`, `API_CENTER_CLOUD_RUN_AUTH_ENABLED=true`, and `MANAGEMENT_PUBLIC_BASE_URL` to `https://apicenter-management-test-565306324295.asia-southeast1.run.app`, then direct traffic to its prior revision. Restore docs traffic to its prior revision if needed. Do not publish secret values while restoring bindings.

To undo DNS configuration, restore the old API alias to `136.68.196.7` with TTL Auto, and remove the three new explicit A records so they inherit the existing wildcard. These prior addresses had no verified working APICenter HTTPS routing at rollout start; restoring them is configuration rollback, not a proven healthy application fallback. Keep the Cloud Run service URLs available during certificate provisioning. Remove only the new dedicated load balancer resources after confirming no remaining DNS or app dependency. Do not use the historical GKE rollback instructions for the current rollout.
