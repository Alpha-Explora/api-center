# APICenter System Cleanup And Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce stale docs, duplicate guidance, and stale guardrails across `api-center`, `apicenter-management`, `api-shared-services`, and the data pipeline while preserving the current APICenter north star.

**Architecture:** Keep `api-center` as the runtime gateway/control plane, `api-shared-services` as the SDK/shared-service artifact repo, and `apicenter-management` as the operator console. Consolidate docs into source-of-truth runbooks, archive completed historical plans, and add machine checks that prevent the same stale decisions from coming back.

**Tech Stack:** NestJS 11, Next.js 16, React 19, Node 24, Prisma/Supabase Postgres, Redis, GKE Autopilot, Vercel for management UI, Confluent Cloud Kafka, Confluent S3 Sink, AWS S3, Glue/Athena, GitHub Actions, GitHub Packages.

---

## North Star

For APICenter, keep the north star as:

```text
From tribe request to gateway decision to event export to visualization, can we
trace who called what, whether it was allowed, what happened, how much it cost,
and where the data landed?
```

Everything in this cleanup should serve that trace:

| Layer | Current owner | Cleanup direction |
| --- | --- | --- |
| Runtime gateway and policy | `api-center` | Make policy, registry, events, and audit behavior easier to verify. |
| Management console | `apicenter-management` | Make operator actions safe, environment-aware, and evidence-driven. |
| SDK and shared services | `api-shared-services` | Keep tribe-facing contracts, manifests, wrappers, and provider runtimes together. |
| Data pipeline | `api-center/infra/aws-data-pipeline` and docs | Make topic discovery, Athena output, curated views, and BI handoff repeatable. |

## Audit Evidence

Commands run during this review:

```powershell
cd C:\Codes\apic\api-center
rg --files -g '*.md'
rg -n "GKE|Vercel|ATHENA_OUTPUT_LOCATION|athena-results/|DataSync|Strimzi|api-center-test-s3-sink|api-center-prod-s3-sink" docs README.md infra gcp scripts src prisma supabase .github
Select-String -Path scripts\check-boundaries.js -Pattern '@apicenter/sdk|api-shared-services|Shared-service manifests' -Context 1,1
Select-String -Path src\registry\registry.service.ts -Pattern 'STORAGE STRATEGY|Redis|Postgres|DATABASE_ENABLED|registrySource|loadFromPostgres' -Context 1,1

cd C:\Codes\apic\apicenter-management
rg --files -g '*.md'
rg -n "Vercel|GKE|API_CENTER_BASE_URL|MANAGEMENT_ENVIRONMENT|CONFLUENT_S3_CONNECTOR_NAME|ownerTribeId|sourceServiceId" README.md docs src

cd C:\Codes\apic\api-shared-services
rg --files -g '*.md'
rg -n "GitHub Packages|@implementsprint/sdk|publishTribeEvent|sourceServiceId|shared-services/manifests" README.md docs src tests shared-services gcp
```

Observed doc volume:

| Repo | Plan docs | Main docs signal |
| --- | ---: | --- |
| `api-center` | 18 tracked `docs/superpowers/plans/*.md` files plus one untracked Control Tower plan | Several long plans still contain historical decisions and old commands. |
| `apicenter-management` | 17 tracked `docs/superpowers/plans/*.md` files | Some older plans say GKE/internal deployment while newer plans and code support Vercel OIDC. |
| `api-shared-services` | 0 superpowers plan docs | Docs are more product-facing and less plan-sprawled, but README overlaps with consumer runbooks. |

## Key Current Decisions

### Decision 1: Keep Tribe-Level Topic Ownership

**Decision:** Keep one owner-tribe topic per tribe/environment, not per microservice. Microservice identity stays in payload and metadata as `sourceServiceId`.

**Pros:**

- Visibility aligns with the tribe boundary the platform wants to enforce.
- S3, Glue, Athena, BI, and access review stay tribe-centered.
- Microservices can still be traced through `sourceServiceId`.
- Connector topic count stays lower.

**Cons:**

- Bad event hygiene from one microservice can affect the tribe topic quality score.
- Per-service replay or retention requires filtering, not separate physical topics.
- Data quality tooling must preserve `sourceServiceId` from Raw through Gold.

**Decision guardrails:**

- Do not create per-service Kafka topics unless there is a named compliance or throughput reason.
- Any exception needs an entry in `docs/data-pipeline/pipeline-exception-request-template.md`.
- Docs should say `ownerTribeId` is the topic owner and `sourceServiceId` is attribution.

### Decision 2: Keep Management On Vercel For Now

**Decision:** Treat Vercel as the active management UI hosting direction, while keeping private GKE identity docs as a fallback for network-private operations.

**Pros:**

- Faster deployment and easier operator access.
- Existing management code has Vercel OIDC support in `src/lib/server/gcp-secret-manager.ts`.
- Readiness code checks deployed-local-dev misconfiguration in `src/lib/server/deployment-config.ts`.

**Cons:**

- Private GKE-only admin endpoints may not be reachable from Vercel.
- Vercel function/runtime limits may matter for long-running provider operations.
- Docs still contain both Vercel and GKE paths, so operators can choose the wrong one.

**Decision guardrails:**

- Management docs should label Vercel as current default.
- GKE management docs should be marked fallback/private deployment only.
- Provider-impacting operations should stay behind server-side action policy and environment banners.

### Decision 3: Keep SDK Source In `api-shared-services`

**Decision:** `@implementsprint/sdk` and shared-service manifests stay in `api-shared-services`; `api-center` is runtime-only.

**Pros:**

- Tribe-facing contract, package release, and manifests move together.
- Gateway does not accidentally become an SDK publishing repo again.
- GitHub Packages auth guidance has one owner.

**Cons:**

- Cross-repo contract checks need to tolerate missing sibling checkouts in CI.
- API Center docs can become stale if SDK docs evolve independently.

**Decision guardrails:**

- Fix active guardrails that still name `@apicenter/sdk`.
- Keep gateway docs linking to shared-services docs instead of copying long SDK install sections.
- Keep `api-center/scripts/check-contract-compatibility.js` as a gateway contract check, but make package naming current.

### Decision 4: Keep Raw S3 Platform-Only

**Decision:** Raw S3 remains platform-only under `s3://api-center-raw-data/topics/...`. Query result artifacts are separated by purpose/environment/tribe and later move to a dedicated Athena results bucket before BI or tribe access.

**Pros:**

- Raw replay/audit data stays protected.
- Athena result cleanup can be lifecycle-managed separately.
- BI and tribe-facing artifacts can get narrower IAM.

**Cons:**

- The pilot still uses the raw bucket for Athena results until the dedicated bucket is created.
- Existing flat Athena result files remain unclassified until they age into cleanup or are explicitly moved.

**Decision guardrails:**

- Normal validation uses `-ResultPurpose` and `-Environment`, not flat `-OutputLocation`.
- Do not grant BI users access to `s3://api-center-raw-data/topics/`.
- Create `api-center-athena-results` before broad dashboard or tribe-facing result access.

## Stale Or Redundant Docs

### Findings

| Area | Evidence | Problem | Decision |
| --- | --- | --- | --- |
| Historical plan sprawl | `api-center/docs/superpowers/plans` has 18 tracked plan docs; `apicenter-management/docs/superpowers/plans` has 17. | Plans contain old phases, partial checklists, and past evidence mixed with future tasks. | Keep plans append-only but add an index with status: active, completed, superseded, archive. |
| Athena output drift | Older data-pipeline plans still mention `s3://api-center-raw-data/athena-results/` as the flat root. | Historical references are acceptable, but active runbooks must not copy flat root commands. | Active runbooks use governed prefixes; historical plans should be marked superseded by `2026-05-20-athena-results-separation-cleanup.md`. |
| Management deployment drift | Management README and ops docs include both Vercel and private GKE identity paths. | Both are valid in different contexts, but the default is unclear. | Label Vercel as current default and GKE as private/internal fallback. |
| GKE vs Cloud Run drift | `api-center/README.md` says GKE is current and Cloud Run is older/simple. | This is mostly clear, but old Cloud Run and migration docs can still be mistaken as current. | Keep Cloud Run docs but add `status: historical option` in the docs index. |
| SDK docs duplication | SDK install/use appears in `api-center/README.md`, `api-shared-services/README.md`, `docs/consumer-runbook.md`, and `docs/tribe-sdk-consumption.md`. | Repeated examples can drift when SDK version, package scope, or token guidance changes. | Make `api-shared-services/docs/consumer-runbook.md` the canonical consumer guide; gateway docs link to it. |
| Shared-service workflow duplication | `api-center/docs/developer/shared-service-team-workflow.md` and `api-shared-services/docs/shared-service-delivery-workflow.md` overlap. | One should describe gateway/platform ownership; the other should describe SDK/runtime delivery. | Keep both, but add cross-links and ownership statements at the top. |
| Data pipeline docs split | Ownership, runbook, Athena results, metric dictionary, and retention controls are spread across several docs. | Good separation, but no single "start here" map exists. | Add `docs/data-pipeline/README.md` as the entrypoint and status map. |

### Pros And Cons Of Cleanup Options

| Option | Pros | Cons | Decision |
| --- | --- | --- | --- |
| Delete old plans | Removes clutter quickly. | Loses evidence and prior decisions; risky because past runs still reference them. | Do not delete yet. |
| Move completed plans to archive | Keeps evidence while reducing active clutter. | Requires link updates and a status index. | Use this after adding the index. |
| Keep all plans in place but add status front matter | Minimal file movement. | Directory remains noisy. | Do this first. |
| Create canonical docs and leave duplicates unmarked | Fast. | Operators still find stale docs through search. | Avoid. Mark duplicates as superseded or historical. |

## Stale Or Risky Code

### API Center

| Finding | Evidence | Risk | Recommended fix |
| --- | --- | --- | --- |
| Boundary checker still names old SDK package | `scripts/check-boundaries.js` descriptions and regex reference `@apicenter/sdk`, while SDK package is `@implementsprint/sdk`. | CI can pass while failing to catch stale `@implementsprint/sdk` local/file dependency drift. | Update descriptions and regex to `@implementsprint/sdk`; add a fixture/test or run `npm run check:boundaries`. |
| Registry service header is stale | `src/registry/registry.service.ts` header says Redis is the source of truth, but the code supports `REGISTRY_SOURCE=postgres`, dual-write, and `loadFromPostgres()`. | Future maintainers may misunderstand the current DB cutover model. | Update the header and inline comments to describe Redis current default plus optional Postgres source/dual-write. |
| Registry persistence still has split behavior | Strict Redis writes, optional Postgres dual-write, best-effort health update writes. | Cutover can leave unclear source-of-truth behavior if docs and flags are wrong. | Add a registry persistence runbook and a config matrix for Redis-only, dual-write, and Postgres-source modes. |
| Raw Athena projection enum is manually edited | `infra/aws-data-pipeline/catalog/raw-topic-tables.sql` hardcodes `projection.physical_topic.values`. | Every new topic needs a SQL edit; missing topics block Raw/Bronze validation. | Generate the projection enum from approved topic state or connector topics and apply through a script. |
| API Center CI uses older action versions and weak Docker smoke | `.github/workflows/ci.yml` uses `actions/checkout@v4` and `setup-node@v4`; Docker step starts then stops without readiness assertion. | Build may pass even when container readiness is broken. | Upgrade actions and curl `/api/v1/health/live` or `/api/v1/health/ready` inside the container. |
| Historical comments contain encoding-sensitive punctuation | Several comments render as mojibake in PowerShell output. | Low runtime risk; can make code review noisy on Windows. | Normalize touched comments to ASCII when files are edited for nearby reasons. |

### APICenter Management

| Finding | Evidence | Risk | Recommended fix |
| --- | --- | --- | --- |
| No tracked GitHub Actions workflow | `.github/workflows` is absent in `apicenter-management`. | Vercel may build, but PR validation is not explicit in the repo. | Add CI: `npm ci`, `npm run lint`, `npm test`, `npm run build`. |
| Large component files concentrate behavior | `src/components/service-detail-client.tsx` is about 30 KB; `shared-service-smoke-tests.tsx` about 25 KB; `tribe-form.tsx` about 22 KB. | UI changes become risky and hard to test in small slices. | Split into focused panels/hooks only when touching those flows. |
| Deployment docs mix Vercel and GKE | README and ops docs include both. | Operators may configure the wrong identity path. | Add a deployment decision header: Vercel default, GKE fallback. |
| Pipeline health reads local evidence file | `src/lib/server/pipeline-health-store.ts` reads `PIPELINE_HEALTH_EVIDENCE_FILE`. | Good for pilot, but not enough for live dashboards. | Keep the local file as fallback, then add Athena/API-backed provider behind the same contract. |
| Topic onboarding state uses local JSON by default | `TOPIC_ONBOARDING_STATE_FILE` under local state. | Multi-operator state can drift. | Promote topic state to API Center DB or a controlled evidence store before production onboarding. |

### API Shared Services

| Finding | Evidence | Risk | Recommended fix |
| --- | --- | --- | --- |
| `TribeClient.ts` is large | `src/TribeClient.ts` is about 30 KB and owns auth, retry, shared-service wrappers, and Kafka publishing. | SDK changes have broad blast radius. | Split into internal modules: auth, HTTP/error mapping, payment wrappers, messaging wrappers, discovery wrappers. Preserve public exports. |
| PayMongo tests and service are large | `tests/shared-services/paymongo-provider.test.ts`, PayMongo service, and payment store dominate size. | Payment changes are hard to isolate. | Split PayMongo provider tests by checkout, subscription, webhook, refund, and persistence. |
| Manifest validation is custom JS only | `scripts/validate-service-manifest.js` duplicates schema logic instead of sharing a Zod/schema package. | Management, API Center, and SDK can drift on manifest rules. | Move manifest schema to a shared package/module or generate JSON Schema from one source. |
| GitHub Packages guidance is correct but repeated | README, consumer runbook, and SDK docs all mention `.npmrc` and `GITHUB_TOKEN`. | Token guidance can drift. | Keep `docs/consumer-runbook.md` canonical and link other docs to exact section. |
| Shared-service runtimes are Express JS while SDK is TS | Gateways under `shared-services/*/src/server.js`. | Acceptable for speed, but typed contract drift is easier. | Add contract snapshot checks per manifest route and typed request/response fixtures. |

## Data Pipeline Improvement Review

### Current Strengths

- Raw S3 path and partition projection are documented.
- Bronze lanes now separate tribe events, shared-service events, and APICenter ops events.
- Athena results now support governed prefixes by purpose/environment/tribe.
- Management has a pilot pipeline-health panel contract.
- Retention/access/cost controls are documented.

### Current Gaps

| Gap | Impact | Fix |
| --- | --- | --- |
| Topic projection enum is static | New topics can publish to S3 but remain invisible to Athena until SQL is updated. | Generate/update projection values from management topic state or Confluent connector config. |
| No automated raw-to-bronze apply script | Operators must manually run SQL in the right order. | Add `scripts/data-pipeline/apply-athena-catalog.ps1` that runs raw, bronze, common silver, and gold catalog files. |
| Pipeline health is file-backed in management | Good pilot but not live analytics. | Add a management API provider that queries Athena or API Center curated endpoint. |
| Dedicated Athena result bucket is only documented | BI/tribe reader access is still gated. | Create `api-center-athena-results` bucket and workgroups before dashboard sharing. |
| Data quality rules are in docs, not enforced | Bad events can pass into Bronze as valid if parsing rules miss fields. | Add SQL validation queries and quality thresholds per lane. |
| APICenter ops topics are planned but not all exported as sanitized ops streams | North-star trace needs gateway decisions, cost, and landing evidence. | Define approved ops export event contracts for gateway decision, policy decision, proxy result, provider usage, and S3 landing evidence. |

## Recommended Documentation Structure

### API Center

| Canonical doc | Owns | Action |
| --- | --- | --- |
| `README.md` | High-level runtime overview and current deployment summary | Keep short; link out to deep docs. |
| `docs/developer/shared-service-team-workflow.md` | Gateway/platform shared-service boundary | Keep as platform-side canonical workflow. |
| `docs/data-pipeline/README.md` | Pipeline entrypoint and doc map | Create. |
| `docs/data-pipeline/actual-pipeline-runbook.md` | Current evidence and pilot status | Keep current, no historical sprawl. |
| `docs/data-pipeline/athena-results-runbook.md` | Athena result prefix and cleanup | Keep current. |
| `docs/superpowers/plans/README.md` | Plan status index | Create and classify plans. |

### APICenter Management

| Canonical doc | Owns | Action |
| --- | --- | --- |
| `README.md` | Local setup and current deployment default | Add default-hosting decision. |
| `docs/operations/apicenter-management-runbook.md` | Operator workflows | Keep, but split if it grows further. |
| `docs/operations/test-live-management-strategy.md` | Vercel test/live split and env behavior | Keep current. |
| `docs/superpowers/plans/README.md` | Plan status index | Create and classify plans. |

### API Shared Services

| Canonical doc | Owns | Action |
| --- | --- | --- |
| `README.md` | Repo overview and package metadata | Keep short. |
| `docs/consumer-runbook.md` | Tribe SDK install and use | Make canonical consumer guide. |
| `docs/shared-service-delivery-workflow.md` | Shared-service runtime delivery | Keep canonical for provider/service teams. |
| `docs/service-manifest-automation.md` | Manifest request and validation flow | Keep canonical for service registration automation. |

## Implementation Phases

> **Council review update, 2026-05-20:** Three read-only reviewers checked this
> plan from gateway/runtime, data-pipeline, and docs/CI angles. The plan was
> missing several executable slices after diagnosing them. The phases below now
> include those corrections. Follow the priority table, not only numeric order,
> when choosing the next implementation slice.

### Phase 1: Add Plan Status Indexes

**Purpose:** Keep historical evidence but stop old plans from looking like active instructions.

**Files:**

- Create: `api-center/docs/superpowers/plans/README.md`
- Create: `apicenter-management/docs/superpowers/plans/README.md`

- [x] **Step 1: Create API Center plan index**

Add a table with one row for every plan file returned by:

```powershell
cd C:\Codes\apic\api-center
git ls-files "docs/superpowers/plans/*.md"
```

Use columns:

```markdown
| Plan | Status | Canonical successor | Owner | Notes |
| --- | --- | --- | --- | --- |
```

Allowed statuses:

```text
current
completed
superseded
archived
```

Classify these explicitly:

```text
2026-05-20-athena-results-separation-cleanup.md: completed
2026-05-20-actual-data-pipeline-implementation.md: superseded-by current pipeline runbooks
2026-05-20-data-pipeline-pilot-and-management-health.md: completed pilot and management health slice
2026-05-19-tribe-data-pipeline-ownership.md: superseded-by current data-pipeline runbooks plus Athena results runbook
2026-05-19-tribe-boundary-events-sdk.md: completed core owner-tribe topic decision
```

- [x] **Step 2: Create management plan index**

Add one row for every plan file returned by:

```powershell
cd C:\Codes\apic\apicenter-management
git ls-files "docs/superpowers/plans/*.md"
```

Classify these explicitly:

```text
2026-05-18-apicenter-management-phased-implementation-plan.md: completed
2026-05-18-apicenter-management-next-roadmap.md: current roadmap
2026-05-20-service-manifest-registration-automation.md: current automation plan
2026-05-17-apicenter-management-deployment-safety-workflows-observability-plan.md: mostly completed and superseded by implemented auth/action policy files
```

- [x] **Step 3: Verify index links**

Run:

```powershell
cd C:\Codes\apic\api-center
rg -n "2026-05-20-athena-results-separation-cleanup|2026-05-19-tribe-boundary-events-sdk" docs/superpowers/plans/README.md

cd C:\Codes\apic\apicenter-management
rg -n "2026-05-18-apicenter-management-next-roadmap|2026-05-20-service-manifest-registration-automation" docs/superpowers/plans/README.md
```

Expected:

```text
Each command prints the indexed rows.
```

- [x] **Step 4: Verify every plan is indexed**

Run:

```powershell
cd C:\Codes\apic\api-center
$plans = git ls-files "docs/superpowers/plans/*.md"
$index = Get-Content docs/superpowers/plans/README.md -Raw
$missing = $plans | Where-Object { $index -notmatch [regex]::Escape((Split-Path $_ -Leaf)) }
if ($missing) { $missing; throw "Missing API Center plan index rows." }

cd C:\Codes\apic\apicenter-management
$plans = git ls-files "docs/superpowers/plans/*.md"
$index = Get-Content docs/superpowers/plans/README.md -Raw
$missing = $plans | Where-Object { $index -notmatch [regex]::Escape((Split-Path $_ -Leaf)) }
if ($missing) { $missing; throw "Missing management plan index rows." }
```

Expected:

```text
No missing rows are printed.
```

### Phase 2: Unify Manifest Governance And Approval Gates

**Purpose:** Remove conflicting manifest validation rules across API Center, management, and the SDK/shared-services repo.

**Files:**

- Create: `api-shared-services/contracts/service-manifest.schema.json`
- Modify: `api-shared-services/package.json`
- Modify: `api-shared-services/scripts/validate-service-manifest.js`
- Modify: `api-center/src/shared/dto/service-manifest.dto.ts`
- Modify: `api-center/src/registry/registration-requests.service.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify tests in all three repos around service manifest validation and registration requests.

- [x] **Step 1: Define one manifest contract**

Create a JSON Schema with these required rules:

```text
serviceId: required lowercase slug
name: required string
baseUrl: required absolute URL
requiredScopes: required string array
exposes: required string array
consumes: optional string array
serviceType: optional "tribe" | "shared", default tribe
ownerTribeId: required when serviceType is tribe and serviceId is a microservice; optional for root tribe service and shared service
```

- [x] **Step 2: Align shared-services validator**

Update `api-shared-services/scripts/validate-service-manifest.js` to use the shared schema. It must still reject tribe microservice manifests that omit `ownerTribeId`.

- [x] **Step 3: Align API Center and management validation**

API Center DTO validation and management Zod validation must enforce the same owner-tribe rule. Root tribe services can use `ownerTribeId` equal to `serviceId` or omit it; microservices must set it.

- [x] **Step 4: Fix registration approval gate**

Update `api-center/src/registry/registration-requests.service.ts` so approval recomputes validation immediately before `registry.register()`. If `canApply` is false, approval must fail with the blocking validation messages.

- [x] **Step 5: Share external capability catalog**

Make registration validation accept the same external capabilities that auth/token issuance accepts, including `kafka`. Do not warn on `consumes: ["kafka"]` if the platform catalog declares it.

- [x] **Step 6: Verify manifest governance**

Run:

```powershell
cd C:\Codes\apic\api-shared-services
npm run manifest:validate -- templates/service-manifest.json
npm test -- tests/manifest.test.ts

cd C:\Codes\apic\api-center
npm test -- service-manifest.dto.spec.ts registration-requests.service.spec.ts

cd C:\Codes\apic\apicenter-management
npm test -- src/lib/schemas.test.ts src/lib/service-registration-policy.test.ts
```

Expected:

```text
All three repos enforce the same manifest rule and block invalid approval.
```

### Phase 3: Fix Active Stale Guardrails

**Purpose:** Fix stale code that can mislead CI or maintainers.

**Files:**

- Modify: `api-center/scripts/check-boundaries.js`
- Modify: `api-center/src/registry/registry.service.ts`
- Create: `api-center/docs/developer/registry-persistence-runbook.md`
- Test: `api-center/package.json` scripts already expose `check:boundaries`

- [x] **Step 1: Update SDK package boundary names**

In `api-center/scripts/check-boundaries.js`, replace `@apicenter/sdk` descriptions and regex with `@implementsprint/sdk`.

Expected behavior:

```text
file: dependency on @implementsprint/sdk is forbidden in the gateway.
Local SDK source imports remain forbidden.
```

- [x] **Step 2: Run boundary check**

Run:

```powershell
cd C:\Codes\apic\api-center
npm run check:boundaries
```

Expected:

```text
Boundary check passed.
```

- [x] **Step 3: Update registry persistence comments**

Update the header in `api-center/src/registry/registry.service.ts` so it says:

```text
Storage strategy:
1. In-memory map is the hot cache.
2. Redis is the current default shared source.
3. Postgres can be dual-written and can become the source when REGISTRY_SOURCE=postgres and DATABASE_ENABLED=true.
```

- [x] **Step 4: Create registry persistence runbook**

Create `api-center/docs/developer/registry-persistence-runbook.md` with this config matrix:

```markdown
| Mode | DATABASE_ENABLED | REGISTRY_SOURCE | REGISTRY_DUAL_WRITE | Source of truth | Rollback |
| --- | --- | --- | --- | --- | --- |
| Redis only | false | redis | false | Redis | keep Redis, disable DB flags |
| Redis source + Postgres dual-write | true | redis | true | Redis | set REGISTRY_DUAL_WRITE=false |
| Postgres source | true | postgres | true | Postgres | switch REGISTRY_SOURCE=redis only after drift check |
```

Include verification commands for `npm run db:validate`, `npm run db:backfill:registry`, a Redis/Postgres drift check, and `npm test -- registry.service.spec.ts postgres-registry-store.service.spec.ts`.

- [x] **Step 5: Run focused registry tests**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- registry.service.spec.ts postgres-registry-store.service.spec.ts
```

Expected:

```text
Both suites pass.
```

### Phase 4: Create Data Pipeline Entrypoint

**Purpose:** Make pipeline docs navigable and separate current instructions from historical evidence.

**Files:**

- Create: `api-center/docs/data-pipeline/README.md`
- Modify: `api-center/docs/data-pipeline/actual-pipeline-runbook.md`
- Modify: `api-center/docs/data-pipeline/new-tribe-s3-onboarding-runbook.md`

- [x] **Step 1: Add pipeline README**

Create a status map:

```markdown
# APICenter Data Pipeline

## Current Status

| Capability | Status | Canonical doc |
| --- | --- | --- |
| Tribe event contract | Current | `tribe-event-contract.md` |
| New tribe S3 onboarding | Current | `new-tribe-s3-onboarding-runbook.md` |
| Raw to Bronze | Current | `raw-to-bronze-runbook.md` |
| Athena result separation | Current | `athena-results-runbook.md` |
| Retention/access/cost controls | Current | `retention-access-cost-controls.md` |
| Metric dictionary | Current | `metric-dictionary.md` |
| Test pilot evidence | Current evidence | `actual-pipeline-runbook.md` |
```

- [x] **Step 2: Add projection warning**

Add this to `new-tribe-s3-onboarding-runbook.md`:

```markdown
After adding a physical topic to the S3 Sink, update or regenerate
`infra/aws-data-pipeline/catalog/raw-topic-tables.sql` so Athena projection
includes the physical topic. S3 arrival alone is not enough for Athena visibility.
```

- [x] **Step 3: Verify no active flat Athena output examples**

Run:

```powershell
cd C:\Codes\apic\api-center
rg -n "OutputLocation=s3://api-center-raw-data/athena-results/|-OutputLocation s3://api-center-raw-data/athena-results/" docs infra scripts
```

Expected:

```text
Only historical plan text may match.
```

### Phase 5: Generate Athena Topic Projection

**Purpose:** Remove the manual edit step from new topic onboarding.

**Files:**

- Create: `api-center/scripts/data-pipeline/resolve-athena-topic-projection.js`
- Modify: `api-center/infra/aws-data-pipeline/catalog/raw-topic-tables.sql`
- Create: `api-center/src/data-pipeline/resolve-athena-topic-projection.spec.ts`

- [x] **Step 1: Add projection resolver script**

The script should accept approved topic names from a file or command argument and print a comma-separated, sorted, unique projection enum.

Command shape:

```powershell
node .\scripts\data-pipeline\resolve-athena-topic-projection.js `
  -TopicsFile .\infra\aws-data-pipeline\topic-projection-values.txt
```

Expected:

```text
prod.api-center.shared.payment.events,test.tribe.logistics.events
```

- [x] **Step 2: Move physical topic values to a tracked text file**

Create:

```text
api-center/infra/aws-data-pipeline/topic-projection-values.txt
```

One physical topic per line, sorted.

- [x] **Step 3: Update SQL apply instructions**

Keep `raw-topic-tables.sql` as the Athena SQL template, but document that the enum is generated from `topic-projection-values.txt`.

- [x] **Step 4: Verify resolver**

Run:

```powershell
cd C:\Codes\apic\api-center
node .\scripts\data-pipeline\resolve-athena-topic-projection.js -TopicsFile .\infra\aws-data-pipeline\topic-projection-values.txt
npm test -- resolve-athena-topic-projection.spec.ts
```

Expected:

```text
Output contains all approved test and prod physical topics once.
```

### Phase 6: Add Management CI

**Purpose:** Make management changes verifiable outside Vercel.

**Files:**

- Create: `apicenter-management/.github/workflows/ci.yml`

- [x] **Step 1: Add CI workflow**

Use Node 24 and run:

```yaml
name: Management CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read

env:
  NODE_VERSION: "24"

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run smoke:routes
      - run: npm run build
```

- [x] **Step 2: Run local verification**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run lint
npm test
npm run smoke:routes
npm run build
```

Expected:

```text
All commands pass locally before opening a PR.
```

### Phase 7: Split Management Hotspot Components

**Purpose:** Reduce blast radius in the largest operator UI files.

**Files:**

- Modify: `apicenter-management/src/components/service-detail-client.tsx`
- Create: `apicenter-management/src/components/service-detail/service-identity-panel.tsx`
- Create: `apicenter-management/src/components/service-detail/service-pipeline-panel.tsx`
- Create: `apicenter-management/src/components/service-detail/service-actions-panel.tsx`
- Modify tests around `src/components/service-detail-client.test.tsx`

- [x] **Step 1: Extract read-only identity panel**

Move the service ID, owner tribe, status, base URL, and scope summary rendering into `service-identity-panel.tsx`.

- [x] **Step 2: Extract pipeline panel composition**

Move `ConfluentProvisioningCard`, `ConfluentPipelineStatusPanel`, `DataPipelineHealthPanel`, and topic onboarding state composition into `service-pipeline-panel.tsx`.

- [x] **Step 3: Extract action panel composition**

Move deprecate/retire/activate/delete and proposed action wiring into `service-actions-panel.tsx`.

- [x] **Step 4: Verify service detail tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/components/service-detail-client.test.tsx
```

Expected:

```text
Existing service detail behavior still passes.
```

### Phase 8: Split SDK Client Internals Without Breaking Public API

**Purpose:** Keep `TribeClient` stable for consumers while making wrappers safer to evolve.

**Files:**

- Modify: `api-shared-services/src/TribeClient.ts`
- Create: `api-shared-services/src/internal/http.ts`
- Create: `api-shared-services/src/internal/auth.ts`
- Create: `api-shared-services/src/internal/payment.ts`
- Create: `api-shared-services/src/internal/shared-services.ts`
- Modify: `api-shared-services/src/index.ts`
- Test: `api-shared-services/tests/TribeClient.test.ts`

- [x] **Step 1: Extract HTTP and error wrapper helpers**

Move retryable status/code checks, sleep, and axios error wrapping into `src/internal/http.ts`.

- [x] **Step 2: Extract token handling**

Move authenticate/refresh token payload application into a small internal helper while preserving public `TribeClient.authenticate()` and `TribeClient.refresh()`.

- [x] **Step 3: Extract payment wrapper methods**

Move payment request builders into `src/internal/payment.ts`; keep the public methods on `TribeClient` delegating to the helper.

- [x] **Step 4: Run SDK verification**

Run:

```powershell
cd C:\Codes\apic\api-shared-services
npm run ci
```

Expected:

```text
Private package verification, contract checks, typecheck, tests, build, and npm pack dry-run all pass.
```

### Phase 9: Promote Pilot Pipeline Health To Live Provider

**Purpose:** Move management pipeline health from file-only evidence to live curated data without losing local fallback.

**Files:**

- Modify: `apicenter-management/src/lib/server/pipeline-health-store.ts`
- Create: `apicenter-management/src/lib/server/pipeline-health-provider.ts`
- Modify: `apicenter-management/src/app/api/local/data-pipeline/health/route.ts`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Add tests under `apicenter-management/src/lib/server/pipeline-health-provider.test.ts`

- [x] **Step 1: Add provider interface**

Define:

```ts
export type PipelineHealthProvider = {
  readRows(environment?: string): Promise<unknown[]>;
};
```

- [x] **Step 2: Extend the health row contract**

Before adding a live provider, extend the pipeline health schema with:

```text
connectorName
connectorState
s3Prefix
latestS3ObjectKey
latestS3ObjectAt
latestBronzeObservedAt
latestCommonSilverObservedAt
latestGoldObservedAt
qualityErrorCount
athenaResultLocation
bytesScanned
lastRefreshedAt
```

Keep existing fields backward compatible.

- [x] **Step 3: Keep local file provider**

Wrap the existing `PIPELINE_HEALTH_EVIDENCE_FILE` logic as `LocalFilePipelineHealthProvider`.

- [x] **Step 4: Add API/Athena provider switch**

Use environment variable:

```text
PIPELINE_HEALTH_PROVIDER=local-file | api-center
```

Start with `local-file` default. Add `api-center` only after APICenter exposes a curated endpoint or Athena query proxy.

- [x] **Step 5: Verify route tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/server/pipeline-health-store.test.ts src/app/api/local/data-pipeline/health/route.test.ts
```

Expected:

```text
Existing local-file behavior remains intact.
```

### Phase 10: Provision Dedicated Athena Results Bucket And Workgroups

**Purpose:** Make tribe/BI result access enforceable instead of only documented.

**Files:**

- Create: `api-center/infra/aws-data-pipeline/policies/athena-results-bucket-policy.json`
- Create: `api-center/scripts/data-pipeline/provision-athena-results-controls.ps1`
- Modify: `api-center/scripts/data-pipeline/resolve-athena-output-location.ps1`
- Modify: `api-center/docs/data-pipeline/athena-results-runbook.md`

- [x] **Step 1: Add provision script dry-run**

The script must default to dry-run and print intended changes for:

```text
S3 bucket: api-center-athena-results
Lifecycle: 7-30 day expiry by prefix
Workgroups:
  api-center-platform-validation
  api-center-management
  api-center-tribe-<tribe_id>
Output prefixes:
  platform/validation/<environment>/
  management/<environment>/
  tribe/<tribe_id>/<environment>/
```

- [x] **Step 2: Add IAM policy template**

The policy must deny BI/raw-reader access to `api-center-raw-data/topics/*` and allow only approved result prefixes in `api-center-athena-results`.

- [x] **Step 3: Update resolver env default**

Keep `api-center-raw-data` as fallback during pilot, but document and test `ATHENA_RESULTS_BUCKET=api-center-athena-results`.

- [x] **Step 4: Verify dry-run**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\provision-athena-results-controls.ps1 -Environment test -DryRun
.\scripts\data-pipeline\resolve-athena-output-location.ps1 -Purpose management -Environment test -ResultsBucket api-center-athena-results
```

Expected:

```text
Dry-run prints no mutating AWS calls.
Resolver prints s3://api-center-athena-results/athena-results/management/test/
```

### Phase 11: Automate Athena Catalog Apply And Quality Gates

**Purpose:** Make Raw, Bronze, Silver, and Gold promotion repeatable and bounded.

**Files:**

- Create: `api-center/scripts/data-pipeline/apply-athena-catalog.ps1`
- Create: `api-center/infra/aws-data-pipeline/queries/validate-quality-thresholds.sql`
- Modify: `api-center/infra/aws-data-pipeline/README.md`
- Modify: `api-center/docs/data-pipeline/retention-access-cost-controls.md`

- [x] **Step 1: Add catalog apply script**

The script must run SQL files in this order:

```text
catalog/raw-topic-tables.sql
catalog/bronze-tribe-events.sql
catalog/bronze-shared-service-events.sql
catalog/bronze-apicenter-ops-events.sql
catalog/common-silver-events.sql
catalog/gold-platform-health.sql
```

Use `scripts/data-pipeline/run-athena-query.ps1` with `-ResultPurpose platform-validation` and a bounded `-Environment`.

- [x] **Step 2: Add quality threshold query**

The query must return counts for:

```text
invalid_quality_count
missing_tribe_id_count
missing_source_service_id_count
unexpected_environment_count
```

- [x] **Step 3: Add bounded scan/workgroup checks**

Document that validation must run in a workgroup with byte limits before scheduled dashboard refreshes.

- [x] **Step 4: Verify with dry-run or test query**

Run:

```powershell
cd C:\Codes\apic\api-center
.\scripts\data-pipeline\apply-athena-catalog.ps1 -Environment test -Profile apic -DryRun
```

Expected:

```text
Script prints the ordered SQL files and governed output location without mutating Athena.
```

### Phase 12: Promote Topic Onboarding State To Durable Evidence

**Purpose:** Prevent local JSON state from drifting across operators.

**Files:**

- Create: `api-center/docs/data-pipeline/topic-onboarding-state-contract.md`
- Modify: `apicenter-management/src/lib/server/topic-onboarding-state-store.ts`
- Modify: `apicenter-management/src/app/api/local/confluent/s3-sink/include-topic/route.ts`
- Modify tests around topic onboarding state.

- [x] **Step 1: Define durable topic state contract**

Document that state can advance only from verified evidence:

```text
Topic provisioned: Confluent topic describe succeeds.
Sink included: connector config contains topic and connector task is RUNNING.
Publishing: APICenter accepted publish and Kafka metrics/logs confirm success.
Raw observed: S3 object exists under the exact physical topic prefix.
Bronze cataloged: Athena/Bronze query returns the physical topic.
Curated active: Common Silver/Gold query returns approved rows.
```

- [x] **Step 2: Keep local JSON as fallback only**

Add provider mode:

```text
TOPIC_ONBOARDING_STATE_PROVIDER=local-file | api-center
```

- [x] **Step 3: Stop optimistic state advancement**

Do not set `topicExists=true` or later states merely because an include-topic API call succeeded. Require the matching evidence field.

- [x] **Step 4: Verify state tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/server/topic-onboarding-state-store.test.ts src/app/api/local/confluent/s3-sink/include-topic/route.test.ts
```

Expected:

```text
State transitions require real evidence fields.
```

### Phase 13: Add Shared-Service Runtime And Deployment Hygiene

**Purpose:** Ensure SDK contracts are backed by buildable and deployable shared-service runtimes.

**Files:**

- Modify: `api-shared-services/cloudbuild.payment-service.yaml`
- Create: `api-shared-services/docs/shared-service-runtime-deployment-matrix.md`
- Modify: `api-shared-services/gcp/gke/README.md`
- Modify: `api-center/gcp/gke/README.md`

- [x] **Step 1: Fix payment Cloud Build context**

Ensure the Cloud Build file references the actual Dockerfile path and build context used by `shared-services/paymongo/Dockerfile`.

- [x] **Step 2: Add runtime matrix**

Document build, image, port, manifest, health path, and smoke command for:

```text
payment
sms
email
gauth
otp
geo
```

- [x] **Step 3: Add stale image guard**

Document an image substitution flow so static GKE manifests do not accidentally redeploy stale pinned tags.

- [x] **Step 4: Verify runtime tests**

Run:

```powershell
cd C:\Codes\apic\api-shared-services
npm test -- tests/shared-services/runtime-gateways.test.ts
npm run ci
```

Expected:

```text
Shared-service route contracts and SDK package checks pass.
```

### Phase 14: Consolidate Canonical Docs And Deployment Banners

**Purpose:** Turn identified documentation decisions into actual doc changes.

**Files:**

- Modify: `api-center/README.md`
- Modify: `api-center/docs/developer/shared-service-team-workflow.md`
- Modify: `api-shared-services/README.md`
- Modify: `api-shared-services/docs/consumer-runbook.md`
- Modify: `api-shared-services/docs/tribe-sdk-consumption.md`
- Modify: `api-shared-services/docs/shared-service-delivery-workflow.md`
- Modify: `apicenter-management/README.md`
- Modify: `apicenter-management/docs/operations/apicenter-management-runbook.md`
- Modify: `apicenter-management/docs/operations/apicenter-management-deployment-runbook.md`
- Modify: `apicenter-management/gcp/gke/README.md`

- [x] **Step 1: Mark SDK canonical docs**

Set `api-shared-services/docs/consumer-runbook.md` as the canonical install/use guide. Replace repeated long install/token blocks elsewhere with short links to that section.

- [x] **Step 2: Mark shared-service workflow ownership**

Add top-of-file banners:

```text
api-center/docs/developer/shared-service-team-workflow.md: gateway/platform boundary source of truth
api-shared-services/docs/shared-service-delivery-workflow.md: SDK/runtime delivery source of truth
```

- [x] **Step 3: Add management deployment status banners**

Add:

```text
Vercel is the current default for the management UI.
Private GKE is a fallback only when admin endpoints are network-private or Vercel limits block an operation.
```

- [x] **Step 4: Verify duplicate guidance was replaced**

Run:

```powershell
cd C:\Codes\apic
rg -n "GITHUB_TOKEN|npm install @implementsprint/sdk|Private GKE Deployment Identity|Vercel is the current default" api-center apicenter-management api-shared-services
```

Expected:

```text
SDK install details appear in the canonical consumer runbook; other docs link to it.
Management deployment docs clearly label Vercel default and GKE fallback.
```

## Cleanup Priority

| Priority | Slice | Reason |
| --- | --- | --- |
| P0 | Unify manifest governance and approval gates | Current validators disagree on `ownerTribeId`, and approval can bypass stale validation. |
| P0 | Fix active stale guardrails | Small change, prevents wrong SDK/package assumptions. |
| P0 | Add full plan indexes | Reduces confusion immediately without deleting evidence. |
| P0 | Add registry persistence runbook | Prevents Redis/Postgres cutover confusion before more registry changes. |
| P1 | Add data-pipeline README and projection warning | Directly improves next tribe onboarding. |
| P1 | Add management CI | Prevents UI/route regressions before Vercel deploys. |
| P1 | Generate Athena topic projection | Removes manual catalog drift. |
| P1 | Provision dedicated Athena results controls | Required before BI or tribe-facing query result access. |
| P1 | Automate Athena catalog apply and quality gates | Turns manual SQL promotion into repeatable validation. |
| P1 | Add shared-service runtime deployment matrix | Ensures SDK methods map to buildable/deployable runtimes. |
| P1 | Consolidate canonical docs and deployment banners | Converts the stale-doc decisions into visible operator guidance. |
| P2 | Split management hotspots | Improves maintainability without changing behavior. |
| P2 | Split SDK internals | Reduces future SDK release risk. |
| P2 | Promote durable topic state and live pipeline health provider | Needed before production dashboards and multi-operator onboarding. |

## Completion Criteria

- Historical plans are indexed by status, and active docs point to canonical runbooks.
- Every tracked plan in `api-center` and `apicenter-management` has an index row.
- SDK install/use guidance has one canonical consumer runbook and summary-only links elsewhere.
- Active docs no longer instruct operators to use stale Athena flat output roots.
- API Center boundary checks refer to `@implementsprint/sdk`.
- Registry persistence docs/comments match Redis default plus optional Postgres cutover, dual-write, rollback, and drift checks.
- Manifest validation is governed by one contract across API Center, management, and shared-services.
- Registration request approval recomputes and blocks on validation before runtime registration.
- Management has CI that runs lint, tests, route smoke, and build.
- New topic onboarding includes Athena projection update or generation from an authoritative source.
- Dedicated Athena result bucket/workgroup controls are provisioned or explicitly gated before BI/tribe result access.
- Athena catalog apply, quality threshold, and bounded-scan checks are scripted.
- Topic onboarding state is either durable or explicitly marked local-file fallback.
- Large management and SDK files have a staged split plan with tests.
- Shared-service runtime build/deploy paths are verified for all six shared services.
- Raw S3 remains platform-only, Athena results stay separated, and BI/tribe access stays gated on a dedicated results bucket/workgroup.

## Open Risks

| Risk | Mitigation |
| --- | --- |
| Moving old plans may break links from prior chat/runbooks | Add indexes first, then archive only after link search. |
| CI may fail because package lock or generated files are stale | Run local `npm ci`/build before opening PR. |
| Athena projection generation can diverge from Confluent connector config | Use connector topics as a validation source before applying SQL. |
| Splitting SDK internals can break consumers | Preserve exported types and run `npm run pack:check`. |
| Vercel management cannot reach private API Center admin endpoints | Keep private GKE fallback docs and add readiness checks that show reachability. |
| Manifest schema centralization can break older service manifests | Add compatibility fixtures for root tribe service, tribe microservice, and shared service before enforcing. |
| Dedicated Athena bucket provisioning can alter access assumptions | Start with dry-run, policy review, and test workgroup before granting readers. |
| Topic state durability can conflict with local evidence files | Keep local-file provider as read-only fallback during migration. |
