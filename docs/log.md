# Documentation bundle changes

## 2026-11-14

- Recorded the selected control plane rebuild direction as a proposed design, including a logical schema, explicit authorization, tenancy constraints, migration and rollback gates, and preservation of existing operability safeguards. Written-design approval and implementation remain pending.
- Recorded the approved operability implementation in the maintained go-live and release verification runbook, including credential recovery, redacted diagnostics, event replay, protected runner configuration, and explicit external acceptance gaps.
- Updated the consumer OpenAPI and generated references for identity and supported shared-service HTTP operations. Reconciled capability and architecture guidance with the implemented coverage.
- Retained the implementation plans while deployment, provider acceptance, and trusted event-consumer acknowledgement remain incomplete. No production readiness is inferred from local checks.

## 2026-11-13

- Proposed an operability design covering guided go-live, credential lifecycle controls, request diagnostics and payment event replay, shared-service HTTP contracts, and repeatable release verification. The user subsequently approved implementation; fresh deployed acceptance remains pending.

## 2026-10-12

- Documented the gateway's per-service credential prefix and per-instance database pool budget after Serbizio onboarding exposed the legacy prefix and a Supabase session-pooler capacity failure. The dated rollout record distinguishes registration, pending live approval and credential acceptance.
- Clarified service registration environments and live approval requirements after the deployed form accepted unsupported labels and omitted confirmation fields. Updated the consumer guide to distinguish a deployment called staging from APICenter's test credential environment.
- Applied the approved hostname rollout: recorded active HTTPS certificates, four Cloudflare records, deployed app revisions, confirmed OAuth origin, access restrictions, and rollback inputs. Aligned active SDK, Management, public contract, and docs app URL examples with the canonical API and docs hostnames. Added the hosted access runbook and fixed docs redirects behind the load balancer. Interactive sign-in and consumer/provider acceptance remain pending in the rollout record.
- Prepared the hosted domain rollout execution plan after scope approval. A separate local APICenter stack is excluded; cloud configuration changes and execution-plan review remain pending.
- Recorded the approved APICenter hostname layout and proposed consumer access requirements in a working specification, including local backend access, private runtimes, and the pending authenticated cloud inventory.
- Compared provider credential onboarding and identity models with APICenter's current service credential flow. Recorded evidence and open decisions without selecting a replacement design.
- Recorded the APICenter Cloud Run deployment, service URLs, Blaine billing link, Supabase reset, and live checks.
- Distinguished verified startup and database access from provider actions and interactive Google sign-in that were not exercised.
- Kept the one-time Supabase data reset out of the repository migration sequence so a future environment cannot replay it accidentally.
- Refreshed the docs app's consumer and Management guides for SDK 2.0.0, the Organization → Tribe → Project → Service hierarchy, service credentials, and Google sign-in settings.
- Removed the active AlphaCI consumer claim from current architecture notes and marked AlphaCI-specific operator guidance as unverified reference material.
- Reviewed the updated content against the repository source; no docs build or test suite was run for this refresh.

## 2026-10-11

- Reconciled the local cloud review and retired remediation plan with the canonical documentation index from PR #153.
- Preserved the dated cloud observations without claiming a new cloud verification.
- Corrected the docs workspace start command to serve the static export.

## 2026-10-10

- Added a canonical index, maintenance rules, current architecture map, and capability/evidence register.
- Added explicit ownership, authority, audience, and verification metadata. Historical deployments and incomplete plans remain evidence-qualified.
- Consolidated guide registration, enabled native MDX rendering, and preserved legacy guide/reference bookmarks.
- Made HTTP reference facts contract-derived and corrected payment authentication, response statuses, examples, and ownership wording.
- Restored framework-owned responsive endpoint layout with accessible code examples on narrow screens.
- Added automated documentation audits, contract fidelity tests, complete static-guide/link coverage, and a lightweight PR workflow.

Verification results are recorded in the corresponding pull request. This entry does not claim current provider or deployment behavior.
