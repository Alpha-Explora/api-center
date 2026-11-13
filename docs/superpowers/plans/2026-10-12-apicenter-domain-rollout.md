---
title: APICenter hosted domain rollout implementation plan
status: active
authority: informative
owner: platform-maintainers
audience: [maintainers, engineers, operators]
last_verified: unverified
verification: unverified
sources: [docs/superpowers/specs/2026-10-12-apicenter-domain-layout-design.md, infra/gcp/cloud-run/workspace, contracts/public/apicenter.openapi.yaml, apps/management/src/lib/service-onboarding.ts, apps/docs/content/guides.json]
---
# APICenter hosted domain rollout implementation plan

> The user approved this plan and selected native execution in this chat on 2026-10-12. Steps use checkboxes for tracking. Live progress and rollback inputs are recorded in the dated domain rollout record.

**Goal:** Make the three approved APICenter hostnames work with hosted service credentials while retaining private runtimes.

**Architecture:** One global external HTTPS load balancer routes each hostname to the appropriate Cloud Run app. Consumers authenticate at the gateway with APICenter credentials; the gateway authenticates its private runtime requests with Google identity. A separate local APICenter deployment is not required.

**Tech stack:** Existing TypeScript monorepo, Cloud Run, Google HTTPS load balancing and certificates, Cloudflare DNS, Google OAuth, and existing provider integrations.

**Spec:** [Domain layout and consumer access](../specs/2026-10-12-apicenter-domain-layout-design.md).

## Global constraints

- Management: `apicenter.itsandbox.site`.
- Consumer API: `api.apicenter.itsandbox.site`.
- Public developer docs: `docs.apicenter.itsandbox.site`.
- Consumer backends, including those on localhost, require no Google IAM identity to use the API hostname.
- Preserve service/environment authorization, quotas, and management guards. Never expose service secrets to browsers.
- Keep shared runtimes private and preserve the gateway's authenticated runtime invocation.
- Preserve unrelated dirty workspace changes, existing host rules, billing, database data, and historical deployment records.
- Do not initialize or mutate recovered Terraform state. Refresh the live inventory and ownership before selecting resource changes.
- A new hostname does not promote the existing test Management deployment into a live environment.

## Review focus

- A public load balancer does not supply a consumer Google ID token. Gateway IAM invocation must allow the intended load balancer path without opening private runtimes.
- Restricting gateway ingress can break Management's direct Cloud Run calls. Route Management through the API hostname if its direct networking path cannot be preserved.
- Credentials and provider signatures rely on methods, bodies, and sometimes full callback URLs. Keep the old API hostname as an alias where possible rather than redirecting requests.
- Nested API/docs names require certificate coverage for their actual hostnames; `*.itsandbox.site` is insufficient.
- A DNS response through a wildcard record does not prove configured host routing or a valid certificate.

## Task 1: Establish live resource ownership and route authorization

**Files:** Read `docs/deployment-cloud-run.md`, `docs/operations/cloud-live-status-2026-10-12.md`, `infra/gcp/cloud-run/workspace/`, gateway controllers and guards. Create `docs/operations/apicenter-domain-rollout-2026-10-12.md` for non-secret inventory and execution evidence.

**Interfaces:** Produces a dated record naming the actual load balancer, URL map, HTTPS proxy, certificate, backend services, serverless NEGs, current app revisions, and DNS record ownership. It also records the proposed resource diff and exact rollback inputs.

- [x] Refresh `abtorres.it@alphaexplora.com` CLI credentials without replacing ADC or changing the active project/account configuration.
- [x] Inventory Cloud Run services, gateway invocation/ingress settings, URL maps, proxies, certificates, backend services, serverless NEGs, and organization-policy constraints in `apicenter-alpha-20260623`.
- [x] Confirm Cloudflare zone/DNS-edit access. Inspect only the four relevant names: the three approved hostnames and `api-center.itsandbox.site`. Do not print tokens, secrets, or unrelated zone data.
- [x] Trace gateway controllers and global middleware to verify that ordinary service credentials cannot perform administrative or registry writes. Classify intentional health, token-exchange, and signed webhook exceptions. Record any required authorization fix before public access.
- [x] Record existing non-secret configuration and resource versions for rollback. If a sole resource writer or ownership conflict is found, resolve it before applying that resource's diff.

## Task 2: Prepare hostname routing, certificates, and gateway access

**Files:** Create `infra/gcp/domains/apicenter-hostnames.json` to record project, region, hostname-to-service mappings, compatibility alias, and the inventoried load balancer resource names. Update the affected saved manifests under `infra/gcp/cloud-run/workspace/` after actual deployed settings are confirmed.

**Interfaces:** Consumes Task 1's inventory and ownership decision. Produces valid HTTPS host routing and a consumer-accessible gateway, plus recoverable prior configuration.

- [x] Map Management to `apicenter-management-test`, docs to `apicenter-developer-docs-live`, and API to `apicenter-api-gateway-live`, confirming these names against live inventory.
- [x] Reuse existing load balancer resources when ownership and configuration permit; otherwise prepare only the missing APICenter-specific resources. Preserve other host rules and the default route.
- [x] Provision or extend certificates to cover all three exact names and retain the old API name's certificate if its compatibility alias is retained.
- [x] Configure the gateway for requests through the load balancer without consumer Google IAM credentials. Apply only settings allowed by the live organization policy. Keep private runtime IAM invocation checks in place.
- [x] Check the Management-to-gateway network path before restricting ingress. If direct access is incompatible, set Management's server API URL to the canonical API hostname and retain its existing management authorization.
- [x] Publish only the approved DNS record changes, with the old records recorded beforehand. Wait for each certificate to become active; do not report success from DNS alone.

## Task 3: Update canonical URLs and deploy affected apps

**Files:** Update `contracts/public/apicenter.openapi.yaml`, generated `packages/contracts/apicenter-openapi.json` through its generator, `packages/sdk/README.md`, active guides under `apps/docs/content/docs/`, `apps/docs/components/api-doc-layout.tsx`, and `apps/docs/components/vercel-api-doc.tsx`. Update Management defaults/snippets in `apps/management/src/lib/service-onboarding.ts`, `apps/management/src/lib/api-center/client-core.ts`, affected `apps/management/src/lib/server/` URL defaults, `apps/management/src/app/(management)/settings/page.tsx`, and `apps/management/src/app/(management)/docs/consumer-runbook/page.tsx`. Record delivery in `CHANGELOG.md` and `docs/log.md`.

**Interfaces:** Consumes canonical API URL `https://api.apicenter.itsandbox.site`. Produces aligned client examples, onboarding packets, docs links, and deployment origin settings. SDK request paths and authentication interfaces stay the same.

- [x] Read applicable app instructions before edits. Replace active consumer API references with the canonical API origin. Link consumer guides to `https://docs.apicenter.itsandbox.site`; preserve historical operational observations and the compatibility alias record.
- [x] Set Management's actual canonical origin configuration to `https://apicenter.itsandbox.site` and browser-facing API origin to `https://api.apicenter.itsandbox.site`, using the existing configuration variable names verified in source.
- [x] Confirm the Management origin in the existing Google OAuth client, preserving local and Cloud Run origins. Browser inspection after user sign-in found the canonical origin already configured; no edit was needed.
- [x] Update browser CORS allowlists only for actual browser callers. Do not add every backend application's domain or wildcard origins as a requirement for server SDK calls.
- [x] Generate contracts using the repository command. Run documentation/link checks, contract validation, and builds/typechecks appropriate to the edited packages. Report existing checker blockers separately. Do not add or run tests without the user's requested verification scope.
- [x] Build and deploy only affected apps using the existing deployer and runtime identities, preserving existing secret bindings and billing. Record image digests and previous revisions.

## Task 4: Reconcile provider URLs and record acceptance

**Files:** Update actual callback URL configuration in the saved gateway/SMS manifests, applicable provider settings, maintained deployment procedures, `docs/operations/apicenter-domain-rollout-2026-10-12.md`, `docs/log.md`, and the working-document register.

**Interfaces:** Consumes the active HTTPS endpoints. Produces confirmed callback routing and a delivery record that separates deployed, verified, and pending behavior.

- [ ] Inspect configured Resend, Twilio, and payment callback URLs. Preserve a functioning old callback through the API alias during migration. Update provider configuration only where the gateway route and signature rules are confirmed.
- [x] Trace Google Auth's actual consumer flow before changing redirect URIs; do not assume a bearer-protected route accepts an unauthenticated browser redirect.
- [ ] Verify HTTPS and correct app routing for all three hostnames. Check that invalid credentials and anonymous administrative calls fail, while private runtime URLs still require Google IAM authentication.
- [ ] With an approved test service credential and safe request scope, verify token exchange and an authorized non-destructive SDK request from a backend without Google identity. A successful Cloud Run-internal request alone does not prove external consumer access.
- [ ] Verify Management Google sign-in and docs rendering. Provider actions such as sending SMS/email or creating payments require an explicitly agreed test scope; record them as pending if they are not exercised.
- [x] Check compatibility alias behavior without redirecting POSTs. Record per-step rollback: restore host rules/DNS, revert app revisions/origin variables, and restore provider callback URLs. Do not restore credential values by publishing them.
- [ ] Promote completed operating guidance into maintained docs and retire the plan's active pointer only after all required work is complete. No PR publication or merge is included unless separately requested.

## Execution review

Tasks 1 through 3 are applied. All four certificate names are active, the three apps serve through the new HTTPS routing, docs directory redirects retain HTTPS, and the Management OAuth origin is confirmed. Maintained operating guidance is available in the hosted access runbook. The plan remains active for interactive Management sign-in and consumer/provider acceptance. No test suite or provider action was run. See the dated rollout record for observed responses and rollback inputs.
