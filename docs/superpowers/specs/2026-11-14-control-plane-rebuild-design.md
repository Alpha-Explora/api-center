---
title: APICenter control plane rebuild
status: active
authority: informative
owner: platform-maintainers
audience: [engineers, maintainers, agents]
last_verified: "2026-11-14"
verification: repository
sources: [prisma/schema.prisma, apps/gateway/src/domains/catalog-registry/registry, apps/gateway/src/domains/auth-security/auth, apps/gateway/src/domains/governance, apps/gateway/src/domains/payments, packages/sdk/package.json, docs/operations/operability-and-release-verification.md]
---
# APICenter control plane rebuild

Design status: proposed for review. The user selected a control plane rebuild with gradual migration, retaining the existing capability runtimes. This document makes that direction concrete; it does not claim implementation, deployment, or approval of every detail below.

## Intent and success

APICenter first serves our own applications, and should be reusable by other organizations without requiring them to adopt our company structure. A developer creates a project, enables capabilities, creates an application identity, and makes a test request. Publishing an API and grouping people into teams are optional.

Success means a consumer can use email or payments without registering an upstream URL or exposed routes; access is explicit and bounded by organization, project, and environment; live setup is understandable and independently verified; and existing consumers retain their resource ownership and supported contracts throughout migration.

Rewriting delivery/provider adapters, replacing NestJS or PostgreSQL, billing collection, public marketplace distribution, and automatic public self-service signup are outside the first delivery. Organization bootstrap and administrator-managed membership support the first internal installation. External availability requires a separate acceptance decision, including payment merchant/account ownership under the existing payment ADRs.

## Approaches and selected direction

1. Improve the current forms: smallest change, but keeps caller identity, API publication, implicit permissions, and tribe ownership coupled.
2. Evolve the existing registry in place: less parallel machinery, but moves ownership and authentication through a mixed model over several releases.
3. Replace the control plane behind explicit adapters and migrate project by project: clearer ownership and authorization, with additional migration and compatibility work. This is the direction selected in the conversation.

Implementation choice proposed here: a new set of Nest modules in the existing gateway deployment, rather than another independently deployed gateway. The control plane is a modular monolith; the existing runtime deployments retain their responsibilities. A project/environment routing record selects the authoritative model, preventing two systems from independently mutating the same principal or policy.

## Current evidence and constraints

- `prisma/schema.prisma` makes a project belong to a tribe and combines application placement, routing, scopes, and dependencies in `Service`.
- `RegistryService.getCallableServiceIds` includes project siblings and declared dependencies. `AuthController.scopesFor` derives scopes from these targets. Membership is therefore part of the current effective access calculation.
- The policy engine still requires an active tribe plan for live shared-service access. Existing quotas and plans must be inventoried by actual ownership; they cannot be copied blindly to every project.
- SDK `2.0.0` already exists. A breaking replacement is a future major version, provisionally v3, subject to release inventory. The earlier suggestion to release SDK v2 was outdated.
- Payments owns provider operations, resource mappings, idempotency and an outbox. Current events use Pub/Sub. A generalized destination model must preserve this transport and its replay semantics during migration.
- The working tree contains locally implemented credential lifecycle, readiness, diagnostics, event recovery and release verification work. Its external acceptance is still pending. The rebuild must preserve those invariants and adapt their ownership, rather than assume their cloud behavior has been proven.
- Current payment ADRs constrain merchant ownership and first-party usage. Adding organization tenancy does not authorize unrelated companies to share our payment merchant account.

## Target vocabulary and ownership

| Concept | Meaning and ownership |
| --- | --- |
| Organization | Tenant boundary owning projects, memberships and optional teams. Internal installation bootstraps one organization. |
| Project | A product such as Serbizio. Owned directly by one organization; ownership is immutable in the first release. |
| Environment | A project workspace with kind `test` or `live`. Configuration, identities, credentials, grants, destinations and resource access are isolated here. |
| Team | Optional group of people within an organization, granted roles on projects. It neither contains projects nor grants application API access. |
| Application | An environment-bound backend, worker or integration identity that calls APIs. The same display name may exist in test and live as separate identities. |
| Capability | Platform-provided behavior such as email, OTP or payments. Enabling it creates environment configuration and readiness requirements, not application grants. |
| Grant | Explicit authorization for one application to perform a catalogued action on a capability or published API in its environment. |
| Credential | An environment-bound way to authenticate an application. It does not independently expand grants. |
| Published API | Optional environment-bound upstream, routes, specification and ingress policy. It is separate from an application's outbound identity. |
| Event destination | Environment-bound subscription to events, with explicit filters and delivery authentication. Delivery execution stays with the owning runtime initially. |

Console roles govern human actions. Application grants govern API requests. An organization owner cannot use a human console session as an application credential.

Proposed console role rules:

- Organization owner: organization settings, membership, all project administration and ownership-sensitive operations. Removing the last active owner is forbidden.
- Organization admin: memberships other than owners, teams and all project administration. Cannot transfer organization ownership or change owner membership.
- Organization developer: create a project and become that project's administrator; access to other projects requires an explicit project assignment. Organization viewer: view basic organization metadata and projects to which they have access. Neither role implicitly receives application credentials or access to every project.
- Project admin: manage project members/teams, environments, applications, grants, secret references, credentials and publication, including live actions after existing readiness gates. Project developer: manage test configuration, applications, grants and credentials; read sanitized live configuration and request live changes. Project viewer: read sanitized configuration and activity. No role can retrieve existing secret plaintext or unredacted diagnostics.
- Team assignments grant the same project roles as direct assignments; effective access is their union, bounded by organization membership status. Only organization owner/admin can modify organization-level roles. Legacy membership migration computes this action matrix and blocks on an unexplained privilege expansion.

## Proposed relational schema

This is a logical schema for implementation planning, not executable migration SQL. Identifiers are opaque; existing public resource IDs remain stable. New tenant-owned child tables carry `organization_id` and use composite foreign keys to prevent inconsistent ownership. Environment-bound relationships also constrain `project_id` and `environment_id`.

| Record | Core fields and constraints |
| --- | --- |
| Organization | `id`, unique `slug`, `name`, `status`. Reuse the existing organization identity. |
| Member | `organization_id`, stable authenticated `subject`, display email, `role`, `status`; unique organization/subject. Existing email memberships need verified identity linking. |
| Team / TeamMember | Organization-scoped team and member relationship; both sides must share the organization. |
| Project | `id`, `organization_id`, organization-unique `slug`, `name`, `status`; keep a legacy ID alias. |
| ProjectRoleAssignment | Organization/project, member or team, role; exactly one assignee kind and no cross-organization references. |
| Environment | `id`, organization/project, `kind`, `status`; unique project/kind. A suspension blocks issuance and requests. |
| Application | `id`, organization/project/environment, environment-unique `slug`, `name`, `status`, `authorization_version`. |
| CapabilityInstallation | Organization/project/environment, capability identifier, `status`, versioned configuration reference and secret references; unique environment/capability. Never store provider secret plaintext in config JSON. |
| ApplicationGrant | Organization/project/environment, application, target kind/ID, catalogued action, status, provenance; unique application/target/action. Cross-environment and cross-tenant targets are invalid. |
| Credential | Organization/project/environment/application, ID and lookup prefix, hashed verifier, status, expiry, revocation metadata, operation receipt reference. Prefix is a hint; the stored environment is authoritative. |
| WorkloadBinding | Same ownership tuple, exact trusted issuer/subject/audience binding, status. No domain-wide wildcard identity matching. API keys are delivered first; workload federation is a later bounded slice. |
| PublishedApi / PublishedRoute | Environment owner, upstream secret/config references, versioned spec and routes. Explicit grants reference this API, not a sibling application's membership. |
| EventDestination | Environment owner, explicit recipient application, subscribed event types, transport/config references, status. Pub/Sub is the first supported transport; HTTPS delivery is retained only where already supported and authenticated. |
| ProjectEntitlement / QuotaPolicy | Project/environment plan, allowed capability actions and limits, enforcement mode and validity. Optional organization-wide ceilings remain shared across projects. |
| UsageRecord | Tenant/project/environment/application, capability/action, trusted event ID, quantity, timestamp and outcome. Duplicate event IDs cannot double-count; request and billable provider units are distinct. |
| LegacyMapping | Source system/kind/ID/environment to new ID, migration revision, evidence digest. Exactly one active mapping per source tuple. |
| ControlPlaneAssignment | Project/environment, authoritative model (`legacy` or `new`), transition revision and fencing version. Changes are audited and atomic. |

Credential material is generated once, shown only through the existing controlled delivery flow and never included in logs, diagnostics or migration reports. Reuse the existing issuance operation receipts and expiry-limited recovery guarantees. The exact hashing algorithm, indexes and migration SQL are implementation decisions requiring security and database review.

## Module boundaries

Add one `control-plane` domain root, with cohesive modules for tenancy, projects/environments, applications/credentials, authorization, capability configuration, API publication and migration. Do not create a service or interface per table. Application use cases own transactions and typed decisions; controllers parse and authorize input; persistence and provider adapters remain infrastructure.

Keep adapters to legacy registry, payment principal resolution, quota enforcement and operational evidence explicit. Existing provider/runtime modules own delivery, payment state and replay. The shared contracts package owns wire types; the SDK consumes those contracts; the console calls gateway use cases instead of recreating policy.

The old registry remains authoritative only for assigned legacy environments. New-model writes never silently mirror into mutable legacy policy. Inventory/backfill can run repeatedly with source revisions; a changed source invalidates reconciliation before cutover.

## Authentication and authorization

1. Resolve credential or workload binding to exactly one organization/project/environment/application. Ignore client-supplied ownership headers for this resolution.
2. Require active organization, project, environment, application and credential. Apply expiry/revocation and current authorization version.
3. Map the requested operation to a catalogued permission. Require an explicit active grant, enabled capability and applicable entitlement. Unknown actions are denied.
4. Enforce project limits and any retained shared organization ceiling. Missing live policy blocks live access; test access has its own bounded defaults.
5. Forward a short-lived signed runtime context with issuer, audience, expiry, request ID, tenant/project/environment/application and resolved resource-owner identity. Runtimes verify it and scope reads/writes accordingly. Reject unsigned header substitutions.

New keys use recognizable test/live prefixes, but cannot be changed from test to live. Rotation stays within the original environment. A restricted credential may narrow an application's grants but cannot enlarge them. Revocation and grant removal must invalidate cached decisions within a documented bound; the first implementation reads authoritative state and does not introduce a long-lived authorization cache.

Quota composition is conjunctive: every applicable project limit and shared ceiling must allow a request; no project setting overrides a shared ceiling. Migrated tribe ceilings retain an explicit covered-project set rather than silently becoming a ceiling over unrelated projects in the organization. Reserve request units across applicable budgets atomically before dispatch, and deduplicate accounting by the scoped operation/request identity. Provider billable units are recorded separately from request admission. Unknown provider outcomes retain their operation receipt and are reconciled; they do not automatically refund a reservation and invite a duplicate charge. Each capability defines its terminal-failure settlement policy before live cutover.

New runtime context support is additive during migration. Legacy context is accepted only for legacy-assigned principals through the trusted gateway adapter, with an explicit expiry/removal gate. Payment resource ownership uses durable mappings to the existing principal until data has been reconciled. Switching authentication must not give another application access to historical payment resources.

## Tenant and environment isolation

Enforce ownership in application authorization and composite database constraints. For tenant-owned data, add PostgreSQL RLS with a non-owner, non-BYPASSRLS application role; scope tenant context to the transaction on the same connection. Pooled connections must not retain tenant state. A row policy alone is not proof of isolation: migration/maintenance identities and runtime-specific data stores need separate review and adversarial integration checks.

Environment kind is immutable. Never fall back from a missing live secret, grant, destination or resource mapping to a test value. Idempotency, replay, usage, diagnostics and credential evidence include the full ownership tuple. A project transfer or merging organizations is excluded from the first release.

Provider bindings are owned by the installation's organization. The internal bootstrap organization retains the existing payment merchant mapping; another organization's payment installation cannot select or inherit that merchant binding. External payment onboarding remains disabled until a separate merchant/account ownership design and acceptance meet the existing ADR constraints. Missing approved bindings block provisioning; there is no platform-wide fallback merchant.

## Developer and operator experience

The console begins at projects. Each project exposes test/live workspaces with capabilities, applications, credentials, activity and event destinations. Team management is organization administration. API publication is an optional project feature.

Test setup: create project, enable a capability, create an application, select its actions, obtain a test credential and execute a documented request. No consumer-only form requires routes or an upstream URL.

Live setup: configure live capability/provider references and destinations; assign entitlements and quotas; complete the existing bounded readiness/release verification; create a separate live application and explicit grants; issue a live credential; verify acceptance; update the consuming deployment. Configuration can be proposed from test but secrets, credentials, readiness evidence and runtime resources are never copied. Unknown provider outcomes require reconciliation before retry. Failure leaves test credentials unchanged and preserves the live operation receipt for recovery.

## Migration and rollback

1. **Inventory and baseline:** record organizations, tribes, projects, service placements, effective scopes, payment consumer identities, credential versions, plans, shared ceilings, resource owners, destinations and contract versions. The uncommitted operability delivery must have a reviewable baseline before product code is mixed with the rebuild. Never copy secrets into the inventory.
2. **Add structures and mappings:** retain existing organization IDs. Resolve each project's organization from its tribe and verify service placement agrees; ambiguous or orphaned records block that project's migration. Convert tribes into optional teams only after membership is reconciled. No inferred team membership may enlarge console access.
3. **Map identities and permissions:** map each legacy service/environment to an application and optionally to a published API. Snapshot effective access against a finite revision of the operation catalog, preserving target/resource restrictions, environment, entitlement and expiry. Record every grant's legacy origin. New siblings or catalog actions do not automatically expand that snapshot. Unrepresentable permissions block cutover rather than widening access.
4. **Preserve budgets and credentials:** retain shared tribe ceilings as explicit shared migration ceilings until an approved allocation exists; do not duplicate the full budget into each project. Preserve credential verifiers and existing authentication through the legacy resolver, without attempting to recover plaintext. New credentials follow the unified lifecycle. Preserve existing payment principal/resource IDs through mappings.
5. **Shadow decisions:** evaluate the new authorization and quota model without issuing provider calls, consuming quota twice, replaying events or duplicating usage. Reconcile allowed/denied decisions, ownership and receipts. Resolve mismatches before moving the assignment fence.
6. **Cut over one project/environment:** use an audited atomic assignment change and write fence. Only one owner accepts identity/configuration mutations. Test precedes live; live also requires environment-specific external acceptance. Record mappings and rollback limits in the cutover receipt.
7. **Retire compatibility:** release the next SDK major and version event contracts before removing tribe fields. Existing Pub/Sub delivery, filters, event IDs and deduplication continue while consumers acknowledge migration. Remove legacy routes/readers only after all assignments and supported consumers have moved and the deprecation gate is satisfied.

Rollback before cutover uses the unchanged legacy assignment. After cutover, provider side effects are never reversed by toggling a flag. Returning to legacy requires reconciliation of new grants, credential issuance/revocation, resource ownership and delivery state; a rollback must not reactivate revoked credentials. If reverse projection cannot preserve these facts, block flag rollback and use a forward repair. Database down-migrations must not delete newly owned records.

## Verification and delivery gates

- Domain tests: explicit grants; no sibling-derived access; immutable environment; suspension, expiry and revocation; finite migrated grants.
- Database integration: composite ownership constraints, RLS with production-equivalent roles, pooled-connection isolation, concurrent issuance receipts, quota accounting and assignment fencing.
- Contract tests: retain supported SDK 2.0 and public payment behavior during migration; next-major SDK and versioned event payloads have explicit compatibility coverage.
- Runtime acceptance: signed context rejects wrong audience, expired identity and forged ownership; cross-tenant/environment resource access fails for every runtime.
- Migration rehearsal: a sanitized fixture covers missing placement, shared tribe quota, changed source revision, partial backfill, legacy keys and historical payment ownership. Repeating the migration does not duplicate entities or grants.
- Critical journeys: test onboarding without API publication; live provisioning with distinct credentials; rotation/revocation; diagnostics and recovery after unknown external outcomes; one reconciled rollback attempt.
- Required repository checks include boundary/monorepo checks, targeted domain/database/contract suites, typechecks, build and documentation checks. Provider/deployment acceptance is recorded separately.

First implementation slice after design approval: organization-owned projects and environments, consumer-only application creation, explicit grants and unified test credential issuance through one capability path. Payments and live cutover follow only after ownership/credential compatibility is proven. Workload identity, broader destinations and external signup do not delay this first slice.

## Decisions for review

The user selected the rebuild and gradual migration. The same-deployment Nest module layout, administrator-managed initial onboarding, environment-bound application rows, API-key-first delivery and test-first first slice are engineering proposals in this document. Approval of this written design is the next gate before the detailed execution plan and product implementation.
