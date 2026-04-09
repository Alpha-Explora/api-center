# APICenter Upgrade Test Matrix

Date: 2026-04-09
Owner: VP Quality
Scope: Upgrade validation for geolocation, geotagging, geofencing, external Kafka governance, and SDK typed methods.

## 1. Scope and baseline

- Gateway namespaces in scope:
  - Tribe: `/api/v1/tribes/:serviceId/*`
  - Shared: `/api/v1/shared/:serviceId/*`
  - External: `/api/v1/external/:apiName/*`
- External API configs currently present in source:
  - `geolocation`, `geofencing`, `kafka`
- Geotagging status:
  - Not currently implemented in `src/external/apis/`.
  - This matrix includes upgrade-required geotagging tests that become mandatory once `geotagging` is added.
- Existing automated test baseline:
  - Unit coverage exists for proxy and registry logic.
  - No e2e specs currently exist under `tests/`.

## 2. Test matrix (unit/integration/e2e)

Legend:
- Status: `E` = existing coverage, `N` = new required for upgrade
- Priority: `P0` ship-blocker, `P1` high, `P2` recommended

| Test ID | Layer | Domain | Status | Priority | Target | Key case | Expected result |
|---|---|---|---|---|---|---|---|
| U-EXT-001 | Unit | Geolocation | N | P0 | `src/external/apis/geolocation.ts` | `createGeolocationApi` maps URL/key/auth header/timeouts/rate limits | Config object matches contract exactly; no missing auth header/value |
| U-EXT-002 | Unit | Geofencing | N | P0 | `src/external/apis/geofencing.ts` | `createGeofencingApi` uses bearer auth and `/health` endpoint | Auth header is `Authorization` with bearer semantics |
| U-EXT-003 | Unit | Geotagging | N | P0 | `src/external/apis/geotagging.ts` (upgrade add) | New geotagging config added and exported | `buildExternalApis` returns `geotagging` entry |
| U-EXT-004 | Unit | External registry | N | P0 | `src/external/apis/index.ts` | Builder includes all required APIs (`geolocation`,`geotagging`,`geofencing`,`kafka`) | Missing API key throws CI test failure |
| U-EXT-005 | Unit | External proxy | N | P0 | `src/external/external.service.ts` | Auth header generation for `bearer`, `apiKey`, `basic` | Outbound headers are correct and deterministic |
| U-EXT-006 | Unit | External proxy | N | P0 | `src/external/external.service.ts` | Successful call publishes `TOPICS.EXTERNAL_REQUEST` | Publish payload validates schema and includes duration/timestamp |
| U-EXT-007 | Unit | External proxy | N | P0 | `src/external/external.service.ts` | Upstream failure maps to `BadGatewayError` | Error is wrapped consistently; no raw Axios leak |
| U-KAF-001 | Unit | Kafka governance | N | P0 | `src/kafka/kafka.service.ts` | `publish()` rejects invalid schema payloads | Throws with schema validation error |
| U-KAF-002 | Unit | Kafka governance | N | P0 | `src/kafka/kafka.service.ts` | Valid publish injects `_meta.timestamp` and `_meta.source` | Produced message always contains `_meta` envelope |
| U-KAF-003 | Unit | Kafka governance | N | P0 | `src/kafka/topics.ts` + `src/kafka/kafka.service.ts` | Topic-to-schema coverage check for non-reserved topics | Every active topic has schema binding or explicit waiver |
| U-SDK-001 | Unit | SDK typed methods | N | P0 | `src/sdk/TribeClient.ts` | `wrapAxiosError()` maps 401/403/404/429/502/503/504 | Correct typed error class per status |
| U-SDK-002 | Unit | SDK typed methods | N | P0 | `src/sdk/TribeClient.ts` | Retry only on retryable statuses/codes; bounded attempts | Non-retryable errors fail fast; max retries honored |
| U-SDK-003 | Unit | SDK typed methods | N | P1 | `src/sdk/TribeClient.ts` | `ensureAuth()` refreshes at 30s pre-expiry boundary | Refresh path triggered at boundary, authenticate fallback works |
| U-SDK-004 | Unit | SDK typed methods | N | P0 | `src/sdk/TribeClient.ts` | Envelope unwrapping of `{ success, data, meta }` | Caller gets payload `data` not wrapper |
| U-SDK-005 | Unit | SDK typed methods | N | P1 | `src/sdk/TribeClient.ts` (type-level) | Generic return typing (`callExternal<T>`, `callService<T>`) | `tsc --noEmit` type assertions pass for typed usage |
| I-EXT-001 | Integration | Geolocation route | N | P0 | External route + service | `GET /api/v1/external/geolocation/*` path rewrite and upstream call | Correct downstream path and 2xx response envelope |
| I-EXT-002 | Integration | Geofencing route | N | P0 | External route + service | `GET /api/v1/external/geofencing/*` with auth header propagation | Upstream receives expected auth header and correlation headers |
| I-EXT-003 | Integration | Geotagging route | N | P0 | External route + service | `GET /api/v1/external/geotagging/*` works once added | Route discovers new API and proxies successfully |
| I-EXT-004 | Integration | External Kafka route | N | P0 | External route + kafka-rest | `GET /api/v1/external/kafka/v3/clusters` via gateway | Returns clusters through gateway envelope |
| I-KAF-001 | Integration | Kafka governance | N | P0 | Kafka producer + schemas | Invalid event payload rejected, valid payload accepted | Validation and publish behavior is deterministic |
| I-KAF-002 | Integration | Kafka governance | N | P0 | External breaker + Kafka | Circuit breaker state transitions emit gateway events | OPEN and CLOSED transitions are published |
| I-KAF-003 | Integration | Kafka governance | N | P1 | Audit path | Proxied calls emit audit events to `api-center.audit.log` | Audit topic receives structured events |
| I-RGR-001 | Integration | Tribe/shared regression | E+N | P0 | `ProxyHandler` + controllers | Namespace mismatch guidance (`shared` vs `tribe`) | 404 with actionable route hint |
| I-RGR-002 | Integration | Tribe/shared regression | E+N | P0 | `ProxyHandler` lifecycle | Deprecated service sets `Deprecation`,`Sunset`,`Link` headers | Headers present and correct |
| I-RGR-003 | Integration | Tribe/shared regression | E+N | P0 | `ProxyHandler` lifecycle | Retired service returns 410 (Gone) | Request is blocked before proxying |
| I-RGR-004 | Integration | Cross-stack regression | N | P0 | Demand -> gateway -> logistics | Correlation ID propagation across hops | Same correlation ID observed end-to-end |
| E2E-001 | E2E | Baseline gateway | E+N | P0 | Docker stack + health | Full stack healthy (`/nginx-health`, `/health/live`, `/health/ready`) | All health endpoints green |
| E2E-002 | E2E | Tribe flow regression | E+N | P0 | Sandbox demand/logistics | Front-door tribe flow succeeds repeatedly | No 5xx under nominal load |
| E2E-003 | E2E | Shared flow regression | N | P0 | Shared namespace route | End-to-end call through `/api/v1/shared/:serviceId/*` | Shared service routing and auth verified |
| E2E-004 | E2E | External geo suite | N | P0 | Geolocation/geotagging/geofencing | End-to-end external calls return expected payload shapes | All three routes proxy with expected auth and envelope |
| E2E-005 | E2E | External Kafka governance | E+N | P0 | kafka-rest via gateway | Cluster discovery + topic publish/read through external kafka route | Kafka external route remains functional post-upgrade |
| E2E-006 | E2E | Rate limiting | E+N | P1 | Gateway + Redis rate limiter | Burst requests eventually return 429 | Limit enforced consistently |
| E2E-007 | E2E | Circuit breaker | E+N | P0 | Gateway + external/downstream outage | Breaker opens on repeated failures and recovers after upstream return | Correct fail-fast then recovery behavior |
| E2E-008 | E2E | SDK typed methods | N | P0 | `src/sdk/TribeClient.ts` in sandbox consumer | `callService`, `callSharedService`, `callExternal` succeed with typed usage | Runtime and type-level SDK behavior both pass |

## 3. Local docker validation sequence (upgrade runbook)

Run from repo root:

1. Pre-clean and bootstrap
   - `docker compose down --remove-orphans`
   - `npm ci`
   - `cp .env.example .env` (first run only)

2. Start stack and wait for health
   - `docker compose up -d --build`
   - `docker compose ps`
   - Health checks:
     - `curl http://localhost:3000/nginx-health`
     - `curl http://localhost:3000/api/v1/health/live`
     - `curl http://localhost:3000/api/v1/health/ready`

3. Static gates (local)
   - `npm run lint`
   - `npm run typecheck`
   - `npm run build`

4. Unit and integration gates
   - `npm test`
   - Add focused suites for this upgrade (example):
     - `npm test -- src/external`
     - `npm test -- src/kafka`
     - `npm test -- src/sdk`

5. Functional docker validation scripts
   - `pwsh ./test-sandbox.ps1`
   - `pwsh ./test-registry-devjwt.ps1`
   - `pwsh ./test-all-steps.ps1`

6. External Kafka governance spot checks
   - `docker exec kafka kafka-topics --list --bootstrap-server localhost:9092`
   - `docker exec -i kafka timeout 5 kafka-console-consumer --bootstrap-server kafka:29092 --topic api-center.audit.log --from-beginning`

7. Shutdown after validation
   - `docker compose down`

## 4. Pass/fail gates for upgrade merge

### Gate G0: Baseline environment
- PASS:
  - All core containers healthy (`nginx`, `api-center-1..3`, `redis-cache`, `redis-rate-limit`, `kafka`, `kafka-rest`).
- FAIL:
  - Any core container unhealthy or flapping.

### Gate G1: Static quality
- PASS:
  - `npm run lint`, `npm run typecheck`, and `npm run build` all pass.
- FAIL:
  - Any static check fails.

### Gate G2: Unit quality
- PASS:
  - All P0 unit tests in matrix pass.
  - New/modified upgrade files have >= 85% line coverage and >= 80% branch coverage.
- FAIL:
  - Any P0 unit failure, or coverage below threshold on touched upgrade files.

### Gate G3: Integration contracts
- PASS:
  - All P0 integration tests pass for external geo/geotagging/geofencing/kafka and governance checks.
  - Namespace/lifecycle regression tests pass (`tribe`, `shared`, `external`).
- FAIL:
  - Any route contract drift, missing headers, or schema-governance regression.

### Gate G4: Docker e2e regression
- PASS:
  - `test-sandbox.ps1`, `test-registry-devjwt.ps1`, and `test-all-steps.ps1` complete successfully.
  - No unexpected 5xx in main path tests.
- FAIL:
  - Any script exits non-zero or key flow breaks.

### Gate G5: Kafka governance
- PASS:
  - Active topics used by gateway have schema validation coverage or explicit governance waiver.
  - Audit and gateway lifecycle events are observable in Kafka during test run.
- FAIL:
  - Ungoverned topic use, or event emission missing for critical flows.

## 5. Regression coverage map (existing tribe/shared/external behavior)

| Behavior | Current coverage | Required in upgrade |
|---|---|---|
| Tribe proxy route guards, scope checks, circuit breaker gate | `src/shared/proxy-handler.spec.ts` covers core behavior | Keep green; add controller-level integration asserting `/api/v1/tribes/:id/*` wiring |
| Shared namespace routing | Indirect via `ProxyHandler` unit coverage | Add explicit integration tests for `/api/v1/shared/:serviceId/*` path and lifecycle headers |
| External namespace routing | Minimal direct automated coverage | Add integration tests for route rewrite, auth header forwarding, and response envelope |
| Service lifecycle governance (active/deprecated/retired) | `src/registry/registry.service.spec.ts` + `ProxyHandler` unit checks | Add end-to-end regression asserting deprecated headers and 410 retirement behavior through HTTP routes |
| Correlation ID propagation | Mostly script-level/manual checks | Add automated integration assertion from inbound header to downstream and back in response metadata |
| Kafka event governance | Producer code has schema checks, little direct test coverage | Add publish validation tests and event observability assertions during integration/e2e runs |
| SDK runtime behavior | No dedicated SDK unit suite today | Add `TribeClient` unit tests for typed errors, retries, token refresh, and envelope unwrapping |
| SDK typed methods at compile-time | No type-level assertions | Add type-check fixture tests (generic return usage) in CI |

## 6. Implementation notes for the upgrade branch

- Geotagging implementation readiness criteria:
  - Add `src/external/apis/geotagging.ts`.
  - Register in `src/external/apis/index.ts` and config surface in `ConfigService`.
  - Add environment keys in `.env.example`.
  - Add unit/integration/e2e tests from this matrix before merge.
- Keep this matrix as release gate source-of-truth for the upgrade PR.
