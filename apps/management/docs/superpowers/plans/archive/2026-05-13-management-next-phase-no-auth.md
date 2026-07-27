# API Center Management Next Phase Plan

**Goal:** Add practical readiness, onboarding, and validation features to the local-only API Center management console without adding authentication, admin users, a database, or public deployment.

**Current baseline:** The console already has local proxy routes, registry listing, registration, edit flow, health checks, lifecycle confirmations, dependency view, SDK panel, event mapping, and manifest import/export.

**Implementation Status:** Implemented on 2026-05-13. The console now includes readiness checks, shared-service setup, onboarding checklist packet export, contract testing, manifest edit diffs, import dry-run validation, and pipeline visibility hooks. Final verification was run with `npm run lint`, `npm run build`, and local smoke checks.

**Superseded note (2026-05-16):** This early plan intentionally avoided
Confluent credentials. Later implemented phases added local/private
operator-only Confluent provisioning routes for topic creation and S3 sink
updates. Tribes still never receive Confluent credentials.

**Non-goals for this phase:**

- Descope admin login
- Admin role management
- Management database
- Public deployment
- Secret reveal or credential rotation UI

## Phase 1: Environment Readiness

- [x] Add `/readiness` page.
- [x] Check API Center base URL reachability.
- [x] Check platform admin secret by calling the protected registry list route.
- [x] Show whether the local proxy is configured safely.
- [x] Show missing env values with exact names, without revealing secret values.
- [x] Add a README section explaining the readiness checks.

## Phase 2: Shared Services Wizard

- [x] Add `/shared-services/setup` page.
- [x] Provide predefined manifests for `gauth`, `geo`, `paymongo`, `email`, `sms`, and `otp`.
- [x] Prefill service IDs, service type, health path, expected exposed routes, required scopes, and tags.
- [x] Allow review before submit.
- [x] Submit selected shared-service manifests through the existing local register proxy.
- [x] Show which shared services are already registered.

## Phase 3: Tribe Onboarding Checklist

- [x] Add checklist section to each service detail page.
- [x] Check owner/contact completeness.
- [x] Check health endpoint presence and latest health result.
- [x] Check consumed services are registered.
- [x] Check SDK env template is complete.
- [x] Check event topic mapping is visible.
- [x] Add an exportable onboarding packet for a tribe.

## Phase 4: Contract Tester

- [x] Add server-side route to test service health and exposed routes.
- [x] Add UI to select an exposed route and method.
- [x] Test direct backend reachability from the local server.
- [x] Test API Center proxy path when the required registry route exists.
- [x] Show status code, latency, response preview, and clear failure reason.
- [x] Do not store request history.

## Phase 5: Manifest Diff And Dry Run

- [x] Show before/after diff on edit before submitting.
- [x] Warn on base URL changes.
- [x] Warn on scope removals.
- [x] Warn on consumed-service changes.
- [x] Add dry-run validation for manifest import.
- [x] Keep actual submit explicit after dry run.

## Phase 6: Pipeline Visibility Hooks

- [x] Show expected Confluent topic names at registry and detail level.
- [x] Add placeholder state for future Confluent topic existence checks.
- [x] Document that S3 sink coverage depends on connector topic configuration.
- [x] Add a manual checklist for verifying topic inclusion in Confluent Cloud.
- [x] Do not add Confluent credentials to this app yet.

## Phase 7: Verification And Cleanup

- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Smoke check `/`, `/tribes`, `/tribes/new`, `/dependencies`, `/manifest-tools`, `/readiness`, and `/shared-services/setup`.
- [x] Update README with new pages and local-only limits.
- [x] Keep the app undeployed until auth is implemented.

## Recommended Commit Plan

Use focused commits:

```powershell
git add docs README.md
git commit -m "docs: plan next management console phase"

git add src/app/readiness src/components/readiness* src/lib
git commit -m "feat: add management readiness checks"

git add src/app/shared-services/setup src/components/shared-service*
git commit -m "feat: add shared services setup wizard"

git add src/components/service-detail-client.tsx src/components/onboarding*
git commit -m "feat: add tribe onboarding checklist"

git add src/app/api/local/contract src/components/contract*
git commit -m "feat: add local contract tester"

git add src/components/manifest* src/lib
git commit -m "feat: add manifest diff and dry run"
```

## Success Criteria

- A local operator can tell whether the console is correctly connected to API Center.
- A local operator can register all shared services with less manual JSON work.
- A tribe can receive a clear onboarding packet from its registered manifest.
- Risky manifest edits are visible before submit.
- Pipeline expectations are clear without requiring Confluent credentials in the management app.
