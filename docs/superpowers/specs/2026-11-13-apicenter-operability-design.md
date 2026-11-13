---
title: APICenter onboarding, credentials, diagnostics, contracts, and release verification
status: active
authority: informative
owner: platform-maintainers
audience: [engineers, reviewers, operators]
last_verified: "2026-11-14"
verification: repository
sources: [apps/gateway/src/domains, apps/management/src, apps/payments/src/events, contracts/public, packages/contracts, packages/sdk, scripts, .github/workflows]
---
# APICenter operability design

## Intent and approval state

Make APICenter easier to onboard, move from test to live, and operate when a request or payment event fails. Complete shared-service HTTP contracts and make release acceptance repeatable.

The user authorized all five improvement areas and approved this design on 2026-11-13. Local implementation is verified. External acceptance remains pending in the five working records; maintained behavior and configuration live in the [operator runbook](../../operations/operability-and-release-verification.md). The baseline observations below describe the starting state and do not establish current deployed provider readiness.

## Approach

Extend the existing gateway domains, Management console, SDK, contracts, and smoke tooling in independently verifiable deliveries. The existing NestJS gateway remains the control plane. Runtime apps retain provider calls and operational data. Management authorizes the human and presents gateway-backed state.

Alternatives considered:

- Improve individual screens without shared evidence. This is smaller initially, but onboarding and release checks would disagree about readiness.
- Create a separate onboarding or observability service. This adds deployment and state ownership without solving a new boundary problem.
- Extend existing owners and use the same evidence for onboarding and release acceptance. This is the proposed approach. It preserves current APIs where possible and makes missing evidence explicit.

The user selected all five outcomes and delegated implementation choices. This approach and the defaults below are the author's proposals, rather than additional user requirements.

## Current behavior and constraints

- `onboarding-checklist-panel.tsx` and `service-onboarding.ts` already derive setup checks and onboarding packets from registry entries. Improve these rather than create another onboarding application.
- Service secrets are scoped to service and environment in Secret Manager. `ServiceSecretResolverService` accepts the current and next hash during the existing rotation lifecycle. Plaintext secrets remain outside persisted application state.
- `PaymentConsumerManagementService` issues environment-specific keys, hashes them, expires new keys after 365 days, and shortens existing keys to at most 24 hours during replacement. Initial live registration requires a project-targeted `payments.live_access` approval. The current revoke operation revokes every active key for the selected consumer and environment.
- The payment provisioning panel lacks live confirmation and reason controls. Management's route-action guard requires those for live writes. The adapter already selects provisioning fields before sending the gateway request, so console confirmation fields must remain local to Management authorization.
- `PromotionEvidenceBundleController` currently infers smoke success from registry presence and can infer health without a fresh probe. Its approval selection is broader than the exact action and target. The bundle service stores generated bundles in process memory.
- The request audit interceptor emits request metadata, but that alone is not a complete, queryable diagnostic record. Payment event dispatch and replay already exist in the payments runtime.
- The public OpenAPI and validation scripts focus on payments. Shared-service TypeScript contracts and guides exist, but full public HTTP coverage remains incomplete.
- CI and public-contract workflows are largely manual. Existing deployment smoke scripts do not prove every authenticated provider operation.
- The current checkout contains substantial pre-existing tracked and untracked work. Do not reset, stash, commit, or discard that work implicitly. Record the baseline and isolate implementation without silently dropping local prerequisites.

Respect organization membership, service placement, project policy, scope checks, runtime IAM, and repository boundaries. Derive tenant placement on the server. A test credential never becomes a live credential, and test resources never migrate as a side effect of activation.

## Delivery order

1. Correct readiness evidence and the live payment provisioning path. Establish the evidence format used by later deliveries.
2. Add the guided service go-live flow and credential inventory and rotation controls.
3. Add request diagnosis and payment event delivery and replay controls.
4. Complete shared-service HTTP contracts, reference rendering, and SDK fidelity checks.
5. Integrate all acceptance checks into a repeatable release command and manual workflow.

Each delivery includes its affected tests and maintained documentation. Deliveries are separate reviewable units. The first delivery does not claim completion of the other four.

## Shared evidence model

Represent checks with explicit `passed`, `failed`, `missing`, `stale`, and `not_applicable` states. A check includes its stable check ID, service, project, environment, source, observation time, configuration fingerprint, deployed revision where available, and a safe result summary. Failed checks include an actionable error code and correlation ID when available.

The configuration fingerprint is computed from relevant non-secret settings and credential version identifiers. It does not hash plaintext secrets or expose stored credential hashes. Approval checks identify the action, target, environment, status, and expiry. A generic approved request cannot satisfy live registration or payment access.

Persist accepted evidence in the gateway's durable store, with an additive migration under its existing ownership. Use existing audit infrastructure for actor and action records. Add bounded retention using the existing history-retention mechanism. An in-memory cache or browser acknowledgement is not proof of acceptance.

Run attempts have `queued`, `running`, `passed`, `failed`, or `interrupted` status. Record steps independently. A restart leaves an unfinished run interrupted; it does not repeat provider writes automatically. Store no plaintext keys, bearer tokens, authorization headers, provider payloads, recipient addresses, or full query strings in evidence.

Repository checks remain valid for their exact commit and artifact. Runtime smoke results expire after 24 hours or when their revision or relevant configuration changes, whichever comes first. Policy and approval checks read current state each time. Unknown revision or unavailable telemetry yields missing evidence, never a synthetic pass. Historical runs remain visible with their original context.

Authenticated consumer checks run in the consumer or a protected CI runner that already has the selected environment's credentials. Management does not request or retain those plaintext credentials. Gateway-owned configuration and health checks may run from Management through the gateway's existing authenticated operations.

Accept runtime reports only from a dedicated verification identity using the existing server authentication and authorization mechanisms. Explicitly authorize that identity for the reported organization, service, and environment. Record the authenticated runner, CI run identity, observed revision, and bounded check results. Consumer credentials authorize the operations under test; a separate runner identity authorizes evidence submission. Operators cannot establish readiness by submitting a `passed` flag or uploading arbitrary JSON. Treat a missing configured runner as blocked verification. Check-run creation, report submission, and artifact display validate the same versioned schema.

## Guided go-live flow

Add a **Go live** section to the existing service detail page. It keeps the existing test configuration and presents blockers with links to the existing forms.

The section covers:

- Live registration and reachable production URL and health path.
- Exact live registration approval and current plan and project policy.
- Allowed scopes and shared-service dependencies.
- Provisioned live service secret metadata without revealing its value.
- For payment consumers, live-access approval, active live payment key, provider configuration readiness, and event delivery where configured.
- Authenticated verification results for the enabled operations.
- Production deployment handoff, including a copyable configuration template with placeholders and the matching environment.

The initial view reads configuration and evidence. It does not send a message, create a payment, rotate a credential, or run OAuth. Each action has a separate button and uses existing role, approval, reason, and confirmation enforcement. Provider checks cannot be enabled by an unchecked client-side flag.

Example content, using the existing console components:

```text
Go live — selected service
Live registration       Complete
Live service secret     Missing       Open service secret
Payment live access     Approved
Authenticated check     Not run       Run verification
Production handoff      Blocked       Complete the checks above
```

Overall readiness is derived, not a manually editable boolean. It means the required evidence is current for the selected configuration. It does not deploy the consumer, switch its traffic, or independently assert that the consumer installed a generated secret.

Fix provisioning so the UI supplies live confirmation and reason, Management checks the actual target environment, and only the gateway's supported payload reaches the gateway. Split key issuance from optional event-subscription setup. If subscription setup fails after issuance, return the created key once with a separate delivery failure and retry only subscription setup. Retrying delivery must not rotate a key or lose the only plaintext response.

Give each key issuance or rotation a client-generated operation ID scoped to service, environment, action, and input fingerprint. Commit a durable receipt and key metadata in the same transaction. A repeated ID with changed input fails with a conflict. After commit, repeating the same request returns its issuance status and safe metadata without issuing again or recovering plaintext. If the original response was lost, return a stable `CREDENTIAL_ALREADY_ISSUED` conflict that links to an explicit replacement action. That action uses a new operation ID and the normal rotation confirmation and overlap. Do not encrypt and persist plaintext merely to replay a response. The UI must explain lost-plaintext recovery before an operator replaces a credential.

Acceptance requires tests for a successful live request, missing or mismatched approval, missing confirmation, incorrect environment, other-organization access, partial provisioning failure, and preservation of test access. Verify the real console flow before declaring the slice complete.

## Credential inventory and rotation

Show separate **Service secrets** and **Payment API keys** sections for the selected service and environment. Display safe identifier or prefix, permissions where applicable, creation and expiry times, rotation state, and last authenticated use when measured. If usage has not been recorded, show **Unknown**, not **Never used**. Service-secret permissions come from current registry policy; they are not embedded key scopes.

Preserve existing payment rotation defaults: 365-day lifetime for the replacement and at most 24-hour overlap for older keys. Display the actual cutoff returned by the server before the operator proceeds. No configurable grace period is required in this program.

Expose stable payment key IDs to authorized operators. Add targeted revocation so retiring an old key cannot revoke its replacement. Keep the existing revoke-all operation as an explicitly labelled emergency action. All lifecycle writes resolve ownership on the server and create audit records. Serializing rotation for the same consumer prevents simultaneous replacements from producing an ambiguous primary key.

Extend the existing service-secret lifecycle rather than giving it the payment-key expiry model. Start dual-valid rotation, verify authentication with the replacement, then revoke the prior secret. Persist the transition before reporting success and invalidate credential caches consistently. Document the maximum cache delay across gateway instances. Existing bearer tokens can remain valid until their documented expiry; revoking a secret must not be presented as immediate bearer-token invalidation.

Record successful authentication against a safe credential identifier, service, and environment. Coalesce usage writes to at most once per minute per credential per instance. Display the observation timestamp and allow for that delay. Do not log secrets or tokens. Treat missing usage telemetry separately from denied credentials.

Acceptance exercises authentication with both payment keys during overlap, rejection of the old key after cutoff, continued acceptance of the replacement after targeted revoke, cross-tenant denial, concurrent rotation, and the service-secret rotation states. Use a controllable clock and database-backed tests for persisted expiry and concurrency behavior.

## Request diagnostics and event recovery

Extend existing Audit and operational views with a service- and environment-filtered request list and a correlation-ID detail view. Search only within the operator's authorized organizations. Use bounded time windows, pagination, and existing retention conventions.

Record a safe request envelope: server-issued request ID, propagated correlation ID, tenant placement when authenticated, service, environment, route template, method, final HTTP status, stable error code, timestamp, duration, and a known failure stage. Stages distinguish authentication, authorization, quota, routing, runtime, and provider failures. Use **Unknown** when the system cannot establish the stage. Capture guard rejection and final exception status rather than assuming that the interceptor sees the final status. Do not persist request or response bodies, raw URLs, or credentials.

The payments runtime remains authoritative for outbox status and event publication attempts. Gateway admin APIs expose authorized summaries and join them to request or resource references when that relationship is recorded. A missing correlation is shown as unavailable. Broker delivery, consumer acknowledgement, and business application are separate observations. Topic creation or IAM setup does not establish delivery success. Unknown last delivery and dead-letter counts remain unknown until telemetry is connected.

Add an authorized **Replay event** action backed by existing runtime replay logic. It is scoped by event, consumer, project, and environment. Keep the original event ID and aggregate version, audit the actor and reason, and make concurrent or repeated replay requests converge on one scheduled replay. Replay publication is not a replay of a payment command. It does not charge or refund again. The action reports scheduling or publication status, not guaranteed business processing.

Derive the replay destination from the original event's immutable consumer, project, and environment. Reject a client-supplied different destination. A request idempotency key identifies one attempt for that event and destination. Allow at most one queued or running attempt for the pair, enforced in persistent storage. Retrying that key returns the attempt; a new explicit attempt is allowed after the previous attempt reaches a terminal result. An uncertain publication outcome requires reconciliation before another attempt. Preserve the original event snapshot, including event ID and aggregate version, across all attempts. Publication remains at least once, so consumers must retain event deduplication.

Acceptance includes denied requests, provider timeouts, unavailable telemetry, bounded queries, other-tenant lookups, duplicate replay submissions, and unchanged event identity. Confirm that secrets and recipient data are absent from persisted envelopes and UI output.

## Shared-service HTTP contracts

Expand the existing canonical `contracts/public/apicenter.openapi.yaml` into the public APICenter HTTP contract. Preserve payment routes, operation IDs, response semantics, and both supported payment credential types. Add explicit tags and operation-level authentication for shared services. A payment API key must not be advertised as authorization for email, SMS, OTP, Geo, or Google Auth.

Inventory every currently supported consumer HTTP operation from gateway routing, runtime validation, SDK exports, and guides. Cover service-token issuance, email, SMS, OTP, Geo, and Google Auth, including lookup and verification operations exposed to consumers. Classify provider callbacks and internal admin routes explicitly and keep them out of the consumer contract. Document browser redirects separately from server SDK calls.

For each included operation, specify request validation, response envelopes and status codes, scopes, idempotency headers where required, redirect behavior, pagination where supported, and actual errors. If runtime, TypeScript contracts, SDK, and guides disagree, record and resolve the mismatch before claiming coverage. Do not invent an operation merely to complete a reference page.

Update the validator's payments-only path restriction, generated JSON, contract tests, and docs rendering together. Use schemas from the existing contracts package where practical and check runtime behavior against contract examples. Keep the existing SDK transport and API shape. Full code generation is outside this program; contract-backed fidelity checks provide the immediate protection.

Acceptance requires an explicit operation inventory with no unexplained omissions, positive and negative runtime cases for each operation family, unchanged payment compatibility, SDK fidelity, and exported reference-page checks. The generated JSON must match the canonical YAML.

## Repeatable release verification

Add one release-verification command and a manual workflow that reuse existing checks. Separate repository verification from authenticated deployment acceptance. Do not enable new automatic deployments or publish packages as part of this change.

The repository phase runs boundary checks, affected tests, workspace typechecks, public-contract and documentation checks, and production builds. Store results against the exact commit. A releasable report requires a clean source snapshot. Local development checks may run with a dirty checkout, but their report must say **Not releasable** and identify that condition without collecting secret file contents.

The deployment phase records environment, base URL, expected commit, observed image digest and revision for each selected runtime, configuration fingerprint, enabled operations, check timestamps, and result. Deployment metadata must come from the build and deployed revision, not from the caller's expected value. A mismatch or missing identity blocks acceptance.

Default deployed checks are authenticated reads and explicit authentication and authorization assertions. Test-environment provider actions use designated fixtures and recipients. Live write checks require an explicitly selected case, exact target, current approvals where applicable, and existing live action confirmation. They never run as a consequence of viewing readiness.

Each write case declares its idempotency key, fixture, expected observation, and cleanup or reconciliation step. Never retry an unknown provider outcome as a new operation. Financial writes need an explicitly bounded operation and amount. Real live payment, message delivery, or consumer deployment is not authorized by approval of this software design alone.

Evidence is a versioned JSON artifact with a concise human-readable summary. Upload it even when checks fail. Record `passed`, `failed`, `skipped`, and `blocked` cases separately. Required cases that are skipped or lack credentials prevent a successful acceptance result. Do not substitute health probes for provider acceptance. Record a passed repository phase separately if external checks remain blocked.

Keep expensive verification and acceptance manually triggered, consistent with the existing documentation policy. Existing lightweight PR checks remain enabled. Operator-supplied credentials come from environment or protected CI secrets, never command-line arguments or report files.

## Implementation ownership

- Registry and governance own placement, approvals, service credentials, and policy. Existing gateway runtime-operations code owns readiness evidence and request diagnostic queries.
- Payment consumer management owns key metadata, rotation, and revoke semantics. The payments runtime owns event attempts and replay execution.
- Management extends service details, onboarding checks, payment-consumer controls, Audit, and operational views. Keep new routes thin and follow the management workspace instructions.
- The contracts package, public YAML, SDK checks, and docs own the consumer contract. Scripts and manual workflows own release orchestration and artifact collection.
- Additive persistence changes require the repository's database migration and PostgreSQL guidance, ownership boundaries, indexes, retention, and rollback review. Do not introduce a second database or direct Management database ownership.

## Documentation and verification

Update maintained architecture and operator guidance as behavior lands, plus affected consumer guides and the root changelog. Keep this design and its implementation plans in the working-document register until all deliveries have evidence. Promote completed decisions into maintained docs and retire completed execution pointers.

For documentation-only preparation, run `npm run check:documentation` and `npm run test:documentation`. Public-contract or public-doc deliveries additionally run `npm run contracts:validate`, `npm run docs:build`, `npm run docs:test`, and `npm run typecheck --workspace @apicenter/docs`.

Run appropriate gateway, runtime, SDK, and Management tests per delivery. Exercise the actual console for UI changes and database-backed behavior for lifecycle, expiry, and replay concurrency. Record pre-existing failures separately from regressions. No green repository check establishes provider, IAM, or deployment behavior.

## Boundaries and builder decisions

This program does not replace authentication, change tenant ownership, introduce a new observability vendor, migrate test records to live, deploy consumer applications, or reconcile cloud Terraform state. Preserve current test access and all existing local work.

The builder may choose focused filenames, exact internal endpoint names, table and index names within existing ownership, and test fixture structure. Reuse existing retention periods where a matching history class exists. If no period exists, use 30 days for diagnostic envelopes and check-run details, retaining release JSON artifacts under CI's configured retention. These are proposed defaults, not claims about today's storage.

Create separate implementation plans for the five deliveries after design approval. Resolve any newly discovered product decision in the design before implementing it. Completion means all five outcomes have their stated repository and runtime evidence, or a specifically identified external prerequisite remains pending with no inflated readiness claim.
