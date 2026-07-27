# Management Local QA - 2026-06-26

## Scope

Local APICenter Management was run against the test API Center configuration at `http://localhost:3010` with `API_CENTER_BASE_URL=https://api-center-test.itsandbox.site`. Secrets were used from local env only and are not recorded here.

## Completed Checklist

- [x] Published `@alpha-explora/apicenter@1.2.2` from `api-shared-services`.
- [x] Verified SDK release workflow `28213210023` completed successfully on GitHub Actions.
- [x] Ran APICenter Management locally on port `3010`.
- [x] Captured browser screenshots for the Management homepage, readiness, registry, lifecycle, shared services, shared-service usage, data pipeline, audit, compliance, reliability, cost, settings, manifest tools, and smoke tests.
- [x] Ran route smoke against every Management page route.
- [x] Confirmed every Management page route returned HTTP 200.
- [x] Captured source-backed local API route results in `api-route-results.json`.
- [x] Added explicit unavailable `meta.sourceMetadata` for API Center admin proxy outages.
- [x] Added explicit unavailable `meta.sourceMetadata` for data-pipeline health and quality outages.
- [x] Updated smoke-route JSON checks so API error bodies are inspected for source metadata.
- [x] Added focused tests for admin proxy, data-pipeline route outages, smoke routes, and source metadata schema coverage.
- [x] Created the user-decision item for the live test API Center TLS reset.

## Verification

- `npm run typecheck` passed.
- Focused Vitest passed: 8 files, 27 tests.
- `npm run smoke:routes -- --base-url http://localhost:3010` completed successfully.
- The smoke run returned HTTP 200 for all 27 page routes.
- The same smoke run allowed the 7 source-backed local API routes to return degraded 500/504 statuses only because each response included the expected source metadata. Those upstream failures are intentionally not hidden.

## Route Smoke Summary

| Category | Result | Notes |
| --- | --- | --- |
| Management pages | 27/27 returned 200 | UI shell and feature routes are locally reachable. |
| Analytics and audit APIs | 3/3 returned 504 | API Center upstream fetch failed; metadata identifies gateway traffic, shared-service usage, and audit event sources. |
| Compliance and evidence APIs | 2/2 returned 504 | API Center upstream fetch failed; metadata identifies audit, promotion, and evidence sources. |
| Data-pipeline APIs | 2/2 returned 500 | API Center pipeline provider failed; metadata identifies Athena-backed health and governance sources. |

## Evidence Files

- `browser-capture-results.json`: browser route state, page title, headings, and visible alerts.
- `api-route-results.json`: JSON response bodies for source-backed local API routes.
- `screenshots/`: categorized browser screenshots.
- `needs-user-decision/api-center-test-tls-reset.md`: remaining live infrastructure blocker.

## Screenshot Index

- `screenshots/01-homepage.png`
- `screenshots/02-readiness.png`
- `screenshots/03-registry.png`
- `screenshots/04-lifecycle.png`
- `screenshots/05-shared-services.png`
- `screenshots/06-shared-services-usage.png`
- `screenshots/07-data-pipeline.png`
- `screenshots/07b-data-pipeline-after-wait.png`
- `screenshots/08-audit.png`
- `screenshots/09-compliance.png`
- `screenshots/10-reliability.png`
- `screenshots/11-cost.png`
- `screenshots/12-settings.png`
- `screenshots/13-manifest-tools.png`
- `screenshots/14-smoke-tests.png`
- `screenshots/baseline-user-reported.png`

## Remaining Decision

The only current blocker is live upstream availability for `https://api-center-test.itsandbox.site`. Local Management runs, page routes load, and API failures are now source-attributed. See `needs-user-decision/api-center-test-tls-reset.md` for the infrastructure checks before redeployment.
