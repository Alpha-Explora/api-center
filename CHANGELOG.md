# Changelog

User-visible changes are recorded under Unreleased until a release is cut. This file starts with the documentation governance update; it does not reconstruct previous releases.

## Unreleased

### Breaking

- SDK 3.0.0, for application keys only. `new ApiCenter()` reads `APICENTER_API_KEY`; `baseUrl`, `APICENTER_URL`, service credentials, access-token providers, `paymentApiKey` and `setup.status()` are removed. Writes generate an idempotency key when none is given and retry network errors, timeouts, 408, 429 and 5xx with the same key, respecting `Retry-After`. Failures are typed (`AuthenticationError`, `PermissionError`, `ValidationError`, `NotFoundError`, `IdempotencyError`, `RateLimitError`, `QuotaExceededError`, `ServerError`, `ConnectionError`) and carry `requestId`. Methods are renamed for consistency (`email.get`, `sms.get`, `otp.send`, `otp.get`, `geo.geocode`, `geo.checkGeofence`, `auth.google.*`). New: `whoami()`, `payments.records.listAll()`, `isPending()`, request hooks, per-call timeouts, `createWebhookHandler()`, and typed webhook events. Webhook and published-API verification use WebCrypto (now async), so the SDK runs on Node 20+, Deno, Bun and edge runtimes. Ships ES modules and CommonJS. See `packages/sdk/UPGRADING.md`.
- Payment event contract 2.0 and contracts 1.0.0: events carry `environment`, `organizationId`, `projectId` and `applicationId`; `ownerTribeId`, `ownerGroupId`, `consumerServiceId` and the duplicated `data` fields are gone, and a paid checkout's `data` is `{ status, checkoutId, paymentId, amount, currency }` with `amount` in minor units. The AsyncAPI contract now lists only the event that is published (`payment.checkout.paid`) and describes signed webhook delivery.
- Removed the sandbox tribe examples, the AlphaCI payment smoke harness, and the consumer guides for service registration, token exchange, registry health and Pub/Sub push delivery.
- Removed the legacy access model. The gateway no longer has tribes, the service registry and service registration, service tokens and refresh tokens (`/api/v1/auth/*`), service secrets and their rotation, payment API keys, the tribe-to-tribe and external proxies (`/api/v1/tribes/*`, `/api/v1/external/*`), tribe quotas, plans and the tribe rate limiter, the catalog, developer portal, policy, entitlement, promotion, change-request and analytics features, the generic approvals API, compliance export, verification runs, and the Vault, Descope, Kafka and internal-JWT settings. Every consumer call needs an application key (`ak_test_…`/`ak_live_…`); `/api/v1/shared/*` and `/api/v1/payments/*` answer 401 without one. The admin API is the control plane's (`/api/v1/admin/control-plane/*`) plus payment event provisioning and request diagnostics, behind the platform credential only.
- Runtimes accept only the gateway's signed runtime context in production; the legacy `X-Tribe-Id`/`X-APICenter-Source-Service-Id` headers are ignored, and outside production a call without a context is a fixed local caller. Runtimes no longer register themselves with the gateway (`REGISTER_WITH_GATEWAY` is gone).
- The console keeps Projects, People, Requests and Settings; the tribe registry, catalog, quotas, plans, dashboards, data pipeline, Confluent, readiness, smoke-test and migration pages are removed. Sign-in looks up memberships at `GET /api/v1/admin/control-plane/memberships`.
- The public OpenAPI has one security scheme, `ApplicationKey`, drops `/api/v1/auth/*`, and adds `/api/v1/whoami`. Reference snippets use `APICENTER_API_KEY`.
- Removed the release verifier and its workflow, the post-deploy and tribe smoke scripts, the legacy-routing guard, and the local Vault container.

### Changed

- The management console is redesigned: a neutral, dense look with light and dark themes; an organization switcher, ⌘K search, and per-project Test/Live switching with live marked in red. Projects live at `/projects/:projectId/:env` with Overview (status, plan, last-24-hour usage by application and action, going live), Applications (an application page with Access and Keys tabs: grant several actions at once, choose a key's expiry, revoke with a reason) and Capabilities (switches; turning one off or changing live asks first). People shows members with roles and teams. Actions a person's role does not allow are disabled with the reason instead of failing. Requests and Settings are shown to platform operators only. Old `/control-plane/*` links redirect.
- Console: capability settings and webhooks. Capabilities gets a Configure sheet for the email sender (it cannot be read back, so saving replaces it) and Google sign-in (redirect URIs, display name, your own OAuth client with a write-only secret, switch back to the shared client or remove); saving in live asks first. A new Webhooks section per environment lists payment event destinations with their status and provisioning errors, adds a signed HTTPS webhook (the secret is shown once, with verification guidance) or a Pub/Sub push destination, rotates a signing secret with a 24-hour overlap, and disables a destination. Applications get a Webhook tab.
- Console: project settings, quotas and workload identities. `/projects/:projectId/settings` assigns, changes and removes project roles for members and teams (warning before removing the last explicit admin) and suspends or resumes test and live. Quotas per environment (`/projects/:projectId/:env/quotas`) and shared ceilings across projects (`/quotas`, organization owners and admins) can be created, disabled and re-enabled; enforcing one in live asks first, and the page says the gateway cannot edit or delete policies or report usage. Applications get a Workload identities tab to bind and revoke Google service accounts that call APICenter with a Google ID token instead of an API key.
- Console: published APIs. A new APIs section per environment publishes HTTP APIs (name, slug, public https upstream, and operations mapping a method and `{param}` path to an action), checked against the gateway's rules before sending; an API's page edits the upstream and operations (saving replaces them all; live edits ask first) and enables or disables it. Project admins approve or reject incoming access requests (not their own; rejection records no reason). The organization API catalog (`/apis`) lists every active API with its operations. The application Access tab gains API access: see and revoke API grants, and request an action on another API, granted at once in the same project or sent to the owning project's admins.
- Console: the sign-in screen, the Google-not-configured and deployment-blocked screens, and the public landing page use the console design system in light and dark. Sign-in shows distinct errors for no access, a failed access lookup, a missing Google client ID and a Google script failure. The landing page previews the console's application Access page and describes only shipped features. Removed the legacy landing palette and animations, a dead Terms link and about 12 MB of unused landing images; the logo stays legible in dark mode.
- Remove Redis. Runtime idempotency and per-recipient send limits for email, SMS and OTP, the gateway's refresh tokens and payment idempotency now live in PostgreSQL (migration `20261118000100`: `<runtime schema>.idempotency_keys` and `rate_limit_windows`, `apic_identity.refresh_tokens`, `apic_governance.payment_idempotency_keys`), purged by the retention job. Gateway rate limits, tribe quotas, traffic and usage dashboards count per instance in memory; dashboard metadata now reports `memory-window`. Readiness no longer reports Redis. Deployments drop every `*_REDIS_URL` setting.

### Fixed

- Adding a webhook endpoint works in deployed environments. Pub/Sub provisioning read `APICENTER_GCP_PROJECT_ID`, which no deployment sets, instead of `GCP_PROJECT_ID` like the rest of the gateway, so every new destination failed. Re-adding an endpoint for an application that had one before no longer fails: updating its existing subscription left out the filter, which Pub/Sub does not allow to change.
- Records created before the control plane (Serbizio's test payments and emails) now carry their organization, project and application directly. Migration `20261119000300` rewrites their legacy owner and service IDs using the control plane's migration mappings and removes the per-request owner mapping.
- Accept PayMongo webhooks on databases upgraded from the retired services. Their `shared_payment.payment_webhook_events` kept an old `environment NOT NULL` column and lacked the `(provider, provider_mode, provider_event_id)` unique index, so every webhook insert failed with a 502. Migration `20261119000100` aligns such databases with a fresh replay: it fixes that table, drops the retired services' leftover tables, views, columns, migration tracker and database roles, and removes `DELETE` from runtime roles. `db:verify:control-plane` now fails if any of it comes back or the webhook index is missing.
- Publish payment events as soon as a verified webhook queues them; the scheduled dispatcher job now only retries. Payment runtime errors without a status are logged with their path and trace instead of returning a bare 502, and failed webhooks log the provider event ID and type. The dispatcher job manifests use the deployed database secrets and no VPC egress.
- Live activation can be approved in the console: project admins see pending `environment.activate_live` requests with Approve and Reject. A decision requires a signed-in person and is recorded under their email; the requester still cannot approve their own request.
- Build shared contracts before compiling gateway images that consume project setup status types.
- Preserve gateway workspace-local dependencies through Docker build/runtime stages and keep the workspace directory layout for Node module resolution.
- Recognize completed PayMongo payments in active checkout sessions, refresh checkout reads by ID and reference, and reconcile saved status without regressing confirmed payments. Include webhook signing-secret references on gateway deployments.
- Refresh refunds from PayMongo on reads and apply signed refund status events without regressing terminal refund states.
- Reconcile payment-link archive responses against the current owner so concurrent paid webhooks and provider archive fields are both preserved.
- Persist fresh payment-intent, subscription, and invoice reads while preserving owner metadata and confirmed terminal states. Clear completed intent redirects and preserve aggregate versions when provider facts are unchanged.
- Register the provider payment found during checkout polling so the existing refund path can resolve it.

### Added

- Request diagnostics record the calling application for shared-service, payment and published-API calls (`caller` on the request), and the audit log names it.
- Signed HTTPS webhooks for payment events, usable by any backend: `POST …/event-destinations/webhooks` takes a public HTTPS URL and returns a `whsec_` signing secret once; `…/rotate-secret` issues a new one and keeps the old one signing for 24 hours. The new `apps/webhooks` delivery service receives each event from the destination's filtered Pub/Sub subscription, signs it in the Standard Webhooks format and POSTs it, refusing private and internal addresses at connect time; Pub/Sub retries anything not answered with 2xx and dead-letters it after the attempt limit. URLs and secrets live in Secret Manager (`apicenter-webhook-<id>`). SDK `verifyWebhook(rawBody, headers, secret)` verifies a delivery and returns the payment event. Requires migration `20261119000200`.
- Add the APICenter control plane: organization-owned projects with separate test and live environments, applications with explicit grants, and `ak_test_`/`ak_live_` application keys. Applications call every shared service and payments without registering a service, URL or routes; the gateway forwards a short-lived Ed25519-signed runtime context that every runtime verifies. Adds console roles (owner, admin, developer, viewer), teams and project roles enforced by the gateway; PostgreSQL row-level tenant isolation; project plans, request budgets and usage; approved live activation; optional published APIs with approved cross-project grants and SSRF-guarded upstreams; per-environment payment event destinations; and a fenced, shadowed, reversible migration from tribes, projects and services. Requires migrations `20261114000100`–`20261114000900` and runtime context keys.
- Add the console Workspace section (Projects, People, Migration).
- SDK 2.1.0: `auth: { apiKey }` for application keys, `createContextVerifier` for published APIs, and payment event contract 1.1 (`ownerGroupId`, `ownerProjectId`; `ownerTribeId` kept for 1.0 consumers).
- Contracts 0.2.0 for SDK 2.1.0: the published contracts package now carries the shared-service HTTP operations and payment event contract 1.1 (0.1.0 shipped with SDK 2.0.0).
- Add redacted request diagnostics and tenant-scoped payment event replay with immutable operation IDs and reconciliation gates.
- Publish supported shared-service and identity HTTP operations in the consumer OpenAPI, with matching reference pages and credential-aware examples.

- Add the contract-backed APICenter 2.0.0 server-side SDK for shared services and payments.
- Allow payment-intent confirmation with a payment method, return URL, and client key, and return the provider's next action for customer redirects.

### Changed

- Verify the existing enabled test-payment database secret reference and guard against reverting to a destroyed historical version.

- Preserve internal payment-runtime ingress during hosted manifest reconciliation and document the separately observed live ingress drift.

- Prepare canonical hosted API/docs hostnames, private-runtime invocation from Management, static docs containers and build-context exclusions; retain existing scaling caps and dated rollout evidence.

- Expose project/service setup checks through the gateway, SDK and console, preserve React hook order, and revalidate payment API-key lifecycle state.

- Replace the generic public landing page with APICenter-specific gateway, registry, governance and shared-service content and clear console/docs entry points.
- Support HTTPS payment-event receivers outside Cloud Run and configurable OIDC audiences while retaining environment and endpoint validation.
- Authenticate private payment runtime calls, preserve uncertain proxy outcomes, restore scoped service JWT payment access, verify Google tokens against registered clients, and bound authenticated health sweeps.
- Bound gateway database pools to two connections per instance by default and allow canonical audit writes on legacy schemas without deleting historical audit values.
- Explain and test explicit legacy-environment conversion before editing registrations, preserving test/live-only writes and live approval checks.

- Limit new service registrations to test/live, submit live approval confirmations, preserve OAuth form drafts during refreshes, and use the versioned membership route.

- Refresh consumer and Management guidance for SDK 2.0.0, organization-scoped access, service registration, and project Google sign-in. Keep operator procedures in the internal `docs/` collection.
- Deploy the APICenter gateway, management console, developer docs, payments, and shared runtimes to Blaine-billed Cloud Run with the `apicenter` service names.
- Start the APICenter Supabase catalog with a fresh organization and no old tribes, projects, or service records; register the deployed shared runtimes.
- Add IAM ID-token authentication from the management console and gateway to private Cloud Run services.
- Allow the deployed gateway to use private Redis and verify each shared-service database login.
- Serve the built developer docs from their static export with the docs workspace start command.
- Include UI, documentation, and root configuration changes in Turborepo cache inputs and preserve exported docs in build outputs.
- Exclude nested environment files and dependency directories from Docker build contexts.

- Added APICenter's canonical internal docs bundle with ownership, authority, evidence, and plan-retirement rules.
- Published all registered consumer guides, including Payment Links, Google Auth, and payment architecture; retained the payment-intents alias.
- Rendered guide links and tables with native MDX and removed leaked frontmatter and generic framework guidance.
- Derived payment reference facts from the public contract, corrected API-key authentication and 201/202 responses, and replaced synthetic shared endpoint pages with maintained-guide notices.
- Corrected narrow-screen endpoint layout and kept code examples available below the title.
- Added fast documentation checks on relevant PRs while keeping expensive CI and artifact publication manual.
