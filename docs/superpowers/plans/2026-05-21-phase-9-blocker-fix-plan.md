# Phase 9 Blocker Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the blockers preventing Phase 9 from becoming a live governed APICenter data-pipeline dashboard.

**Architecture:** Keep APICenter as the central governing tribe/control plane. Move live dashboard reads from fixture-mode to an AWS SDK Athena runtime inside API Center, emit APICenter-owned Athena query telemetry into the existing ops event lane, and add feedback actions only after durable state contracts exist. Do not make management read Raw S3 or run broad unbounded Athena queries.

**Tech Stack:** NestJS/TypeScript API Center, Next.js APICenter management, AWS Athena SDK, Confluent Kafka/APICenter ops events, AWS S3/Glue/Athena, GKE ConfigMap/Secret Manager, Zod, Jest, Vitest.

---

## Original Blockers And Current Status

Phase 9 originally had API, management, and Gold surfaces, but the deployed
dashboard path was not fully live. The blocker-fix implementation below records
the evidence that closed those blockers.

```text
implemented:
  - gold_platform.event_quality_daily
  - gold_platform.gateway_decision_daily
  - gold_platform.shared_service_usage_daily
  - gold_platform.athena_query_cost_daily
  - GET /api/v1/data-pipeline/quality
  - GET /api/v1/data-pipeline/shared-service-usage
  - GET /api/v1/data-pipeline/gateway-decisions
  - GET /api/v1/data-pipeline/cost
  - management /data-pipeline dashboard
  - service-detail pipeline governance panels

fixed_with_evidence:
  - API Center GKE reads pipeline health/governance from Athena through the AWS SDK.
  - API Center no longer depends on an AWS CLI shell-out path for dashboard reads.
  - APICenter emits Athena query-execution telemetry and cost Gold populated for the test partition.
  - Feedback actions have durable Postgres-backed mutation contracts.
  - API Center and management accept optional year/month/day filters for populated partition review while defaulting to current UTC when omitted.
```

## Non-Negotiable Rules

- Test and prod stay separate by `environment`, workgroup, and result prefix.
- Management reads curated APICenter endpoints only, not raw S3.
- Athena reads are bounded by `year`, `month`, `day`, and `LIMIT`.
- API Center must not print or return AWS credentials, platform secrets, or raw event payloads in dashboard responses.
- Cost rows must come from measured query execution bytes, not estimates invented by the UI.
- Feedback actions must persist actor, role, reason, timestamp, target, and evidence link.
- Production-impacting feedback actions must require explicit operator reason and promotion-block state.

## File Map

### API Center Runtime Athena Provider

- Modify: `api-center/package.json`
- Modify: `api-center/package-lock.json`
- Create: `api-center/src/data-pipeline/athena-query-runner.ts`
- Create: `api-center/src/data-pipeline/athena-query-runner.spec.ts`
- Modify: `api-center/src/data-pipeline/pipeline-health.service.ts`
- Modify: `api-center/src/data-pipeline/pipeline-health.service.spec.ts`
- Modify: `api-center/src/data-pipeline/pipeline-governance.service.ts`
- Modify: `api-center/src/data-pipeline/pipeline-governance.service.spec.ts`
- Modify: `api-center/src/data-pipeline/data-pipeline.module.ts`
- Modify: `api-center/Dockerfile`
- Modify: `api-center/docker/Dockerfile.gcp`
- Modify: `api-center/gcp/gke/20-configmap.yaml`
- Modify: `api-center/docs/deployment-gke.md`

### APICenter Athena Query Telemetry

- Create: `api-center/src/data-pipeline/athena-query-telemetry.service.ts`
- Create: `api-center/src/data-pipeline/athena-query-telemetry.service.spec.ts`
- Modify: `api-center/src/data-pipeline/athena-query-runner.ts`
- Modify: `api-center/src/data-pipeline/data-pipeline.module.ts`
- Modify: `api-center/infra/aws-data-pipeline/catalog/bronze-apicenter-ops-events.sql`
- Modify: `api-center/infra/aws-data-pipeline/catalog/gold-platform-governance.sql`
- Create: `api-center/infra/aws-data-pipeline/queries/validate-athena-query-cost.sql`
- Modify: `api-center/infra/aws-data-pipeline/topic-projection-values.txt`
- Modify: `api-center/infra/aws-data-pipeline/catalog/raw-topic-tables.sql`
- Modify: `api-center/scripts/data-pipeline/apply-athena-catalog.ps1`
- Modify: `api-center/docs/data-pipeline/actual-pipeline-runbook.md`

### Feedback Action Contracts

- Create: `api-center/src/data-pipeline/pipeline-feedback.dto.ts`
- Create: `api-center/src/data-pipeline/pipeline-feedback.service.ts`
- Create: `api-center/src/data-pipeline/pipeline-feedback.service.spec.ts`
- Create: `api-center/src/data-pipeline/pipeline-feedback.controller.ts`
- Modify: `api-center/src/data-pipeline/data-pipeline.module.ts`
- Create: `api-center/docs/data-pipeline/pipeline-feedback-action-contract.md`
- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Create: `apicenter-management/src/components/data-pipeline-feedback-actions.tsx`
- Modify: `apicenter-management/src/components/data-pipeline-governance-panel.tsx`
- Modify: `apicenter-management/src/components/data-pipeline-health-panel.tsx`
- Modify: `apicenter-management/src/components/service-detail/service-pipeline-panel.tsx`

### Validation And Ops Documentation

- Modify: `api-center/docs/superpowers/plans/2026-05-20-apicenter-total-data-pipeline-phased-plan.md`
- Modify: `api-center/docs/data-pipeline/actual-pipeline-runbook.md`
- Modify: `api-center/docs/deployment-gke.md`
- Modify: `apicenter-management/docs/operations/apicenter-management-deployment-runbook.md`

---

## Phase 1: Replace AWS CLI Shell-Out With AWS SDK Athena Runtime

**Purpose:** Make deployed API Center capable of reading Athena without relying on `aws` CLI in the container.

**Why first:** This removes the main live-dashboard blocker. Without it, management can only proxy fixture-mode API Center rows.

### Task 1.1: Add AWS Athena SDK Dependency

**Files:**

- Modify: `api-center/package.json`
- Modify: `api-center/package-lock.json`

- [x] **Step 1: Install dependency**

Run:

```powershell
cd C:\Codes\apic\api-center
npm install @aws-sdk/client-athena @aws-sdk/credential-providers
```

Expected:

```text
package.json and package-lock.json include @aws-sdk/client-athena and @aws-sdk/credential-providers.
No source files are changed by this command.
```

- [x] **Step 2: Verify package metadata**

Run:

```powershell
npm ls @aws-sdk/client-athena @aws-sdk/credential-providers
```

Expected:

```text
Both packages resolve under @apicenter/gateway.
```

### Task 1.2: Create `AthenaQueryRunner`

**Files:**

- Create: `api-center/src/data-pipeline/athena-query-runner.ts`
- Create: `api-center/src/data-pipeline/athena-query-runner.spec.ts`

- [x] **Step 1: Write failing tests**

Create `api-center/src/data-pipeline/athena-query-runner.spec.ts`:

```ts
import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { AthenaQueryRunner } from "./athena-query-runner";

describe("AthenaQueryRunner", () => {
  it("starts, polls, and maps Athena rows", async () => {
    const sent: unknown[] = [];
    const client = {
      send: jest.fn(async (command: unknown) => {
        sent.push(command);
        if (command instanceof StartQueryExecutionCommand) {
          return { QueryExecutionId: "query-1" };
        }
        if (command instanceof GetQueryExecutionCommand) {
          return {
            QueryExecution: {
              Status: { State: "SUCCEEDED" },
              ResultConfiguration: {
                OutputLocation:
                  "s3://api-center-athena-results/athena-results/platform/validation/test/query-1.csv",
              },
              Statistics: {
                DataScannedInBytes: 2048,
              },
            },
          };
        }
        if (command instanceof GetQueryResultsCommand) {
          return {
            ResultSet: {
              Rows: [
                {
                  Data: [
                    { VarCharValue: "environment" },
                    { VarCharValue: "tribe_id" },
                  ],
                },
                {
                  Data: [
                    { VarCharValue: "test" },
                    { VarCharValue: "logistics" },
                  ],
                },
              ],
            },
          };
        }
        throw new Error("unexpected command");
      }),
    } as unknown as AthenaClient;

    const runner = new AthenaQueryRunner({
      client,
      pollSeconds: 0,
      timeoutSeconds: 10,
    });

    await expect(
      runner.run({
        query: "SELECT environment, tribe_id FROM gold_platform.pipeline_health_daily",
        database: "gold_platform",
        workgroup: "api-center-platform-validation-test",
      }),
    ).resolves.toEqual({
      queryExecutionId: "query-1",
      outputLocation:
        "s3://api-center-athena-results/athena-results/platform/validation/test/query-1.csv",
      bytesScanned: 2048,
      rows: [{ environment: "test", tribe_id: "logistics" }],
    });
    expect(sent).toHaveLength(3);
  });

  it("fails with the Athena state change reason", async () => {
    const client = {
      send: jest.fn(async (command: unknown) => {
        if (command instanceof StartQueryExecutionCommand) {
          return { QueryExecutionId: "query-1" };
        }
        if (command instanceof GetQueryExecutionCommand) {
          return {
            QueryExecution: {
              Status: {
                State: "FAILED",
                StateChangeReason: "syntax error",
              },
            },
          };
        }
        throw new Error("unexpected command");
      }),
    } as unknown as AthenaClient;

    const runner = new AthenaQueryRunner({
      client,
      pollSeconds: 0,
      timeoutSeconds: 10,
    });

    await expect(
      runner.run({
        query: "SELECT broken",
        database: "gold_platform",
        workgroup: "api-center-platform-validation-test",
      }),
    ).rejects.toThrow("Athena query query-1 ended with FAILED: syntax error");
  });
});
```

- [x] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- src/data-pipeline/athena-query-runner.spec.ts --runInBand
```

Expected:

```text
FAIL because athena-query-runner.ts does not exist.
```

- [x] **Step 3: Implement runner**

Create `api-center/src/data-pipeline/athena-query-runner.ts`:

```ts
import {
  AthenaClient,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StartQueryExecutionCommand,
} from "@aws-sdk/client-athena";

export type AthenaQueryRunnerOptions = {
  client?: AthenaClient;
  region?: string;
  pollSeconds?: number;
  timeoutSeconds?: number;
};

export type AthenaQueryInput = {
  query: string;
  database: string;
  workgroup: string;
};

export type AthenaQueryResult = {
  queryExecutionId: string;
  outputLocation?: string;
  bytesScanned?: number;
  rows: Array<Record<string, string | undefined>>;
};

export class AthenaQueryRunner {
  private readonly client: AthenaClient;
  private readonly pollSeconds: number;
  private readonly timeoutSeconds: number;

  constructor(options: AthenaQueryRunnerOptions = {}) {
    this.client =
      options.client ??
      new AthenaClient({
        region: options.region ?? process.env.AWS_REGION ?? "ap-southeast-1",
      });
    this.pollSeconds = options.pollSeconds ?? 2;
    this.timeoutSeconds = options.timeoutSeconds ?? 120;
  }

  async run(input: AthenaQueryInput): Promise<AthenaQueryResult> {
    const started = await this.client.send(
      new StartQueryExecutionCommand({
        QueryString: input.query,
        QueryExecutionContext: {
          Database: input.database,
        },
        WorkGroup: input.workgroup,
      }),
    );
    const queryExecutionId = started.QueryExecutionId;
    if (!queryExecutionId) {
      throw new Error("Athena did not return a query execution id.");
    }

    const execution = await this.waitForQuery(queryExecutionId);
    const results = await this.client.send(
      new GetQueryResultsCommand({
        QueryExecutionId: queryExecutionId,
      }),
    );

    return {
      queryExecutionId,
      outputLocation: execution.QueryExecution?.ResultConfiguration?.OutputLocation,
      bytesScanned: execution.QueryExecution?.Statistics?.DataScannedInBytes,
      rows: this.parseRows(results.ResultSet?.Rows ?? []),
    };
  }

  private async waitForQuery(queryExecutionId: string) {
    const deadline = Date.now() + this.timeoutSeconds * 1000;

    while (Date.now() <= deadline) {
      const execution = await this.client.send(
        new GetQueryExecutionCommand({
          QueryExecutionId: queryExecutionId,
        }),
      );
      const state = execution.QueryExecution?.Status?.State;

      if (state === "SUCCEEDED") return execution;
      if (state === "FAILED" || state === "CANCELLED") {
        throw new Error(
          `Athena query ${queryExecutionId} ended with ${state}: ${
            execution.QueryExecution?.Status?.StateChangeReason ?? "no reason"
          }`,
        );
      }

      await sleep(this.pollSeconds * 1000);
    }

    throw new Error(
      `Athena query ${queryExecutionId} timed out after ${this.timeoutSeconds} seconds.`,
    );
  }

  private parseRows(
    rows: Array<{ Data?: Array<{ VarCharValue?: string }> }>,
  ): Array<Record<string, string | undefined>> {
    const header = rows[0]?.Data?.map((cell) => cell.VarCharValue ?? "") ?? [];
    return rows.slice(1).map((row) => {
      const mapped: Record<string, string | undefined> = {};
      row.Data?.forEach((cell, index) => {
        const key = header[index];
        if (key) mapped[key] = cell.VarCharValue;
      });
      return mapped;
    });
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
```

- [x] **Step 4: Run tests and verify pass**

Run:

```powershell
npm test -- src/data-pipeline/athena-query-runner.spec.ts --runInBand
```

Expected:

```text
PASS src/data-pipeline/athena-query-runner.spec.ts
```

### Task 1.3: Refactor Health And Governance Services To Use Runner

**Files:**

- Modify: `api-center/src/data-pipeline/pipeline-health.service.ts`
- Modify: `api-center/src/data-pipeline/pipeline-health.service.spec.ts`
- Modify: `api-center/src/data-pipeline/pipeline-governance.service.ts`
- Modify: `api-center/src/data-pipeline/pipeline-governance.service.spec.ts`

- [x] **Step 1: Update service options**

In both services, replace command runner options with:

```ts
athenaRunner?: {
  run(input: {
    query: string;
    database: string;
    workgroup: string;
  }): Promise<{
    queryExecutionId: string;
    outputLocation?: string;
    bytesScanned?: number;
    rows: Array<Record<string, string | undefined>>;
  }>;
};
```

Keep `source`, `fixtureFilePath`, `athenaDatabase`, `athenaWorkgroup`, `year`, `month`, `day`, `queryLimit`, `pollSeconds`, and `timeoutSeconds`.

- [x] **Step 2: Replace `execFile` and `runAwsJson` paths**

In `pipeline-health.service.ts`, replace the Athena read implementation with:

```ts
private async readAthenaRows(
  environment: PipelineHealthEnvironment,
): Promise<PipelineHealthRow[]> {
  const result = await this.resolveAthenaRunner().run({
    query: this.buildAthenaQuery(environment),
    database: this.resolveAthenaDatabase(),
    workgroup: this.resolveAthenaWorkgroup(environment),
  });

  return result.rows.map((raw) => {
    if (result.outputLocation && raw.athena_result_location === undefined) {
      raw.athena_result_location = result.outputLocation;
    }
    if (result.bytesScanned !== undefined && raw.bytes_scanned === undefined) {
      raw.bytes_scanned = String(result.bytesScanned);
    }
    if (raw.last_refreshed_at === undefined) {
      raw.last_refreshed_at = new Date().toISOString();
    }
    return this.normalizeRow(raw);
  });
}
```

Add:

```ts
private resolveAthenaRunner() {
  return (
    this.options.athenaRunner ??
    new AthenaQueryRunner({
      pollSeconds: this.options.pollSeconds,
      timeoutSeconds: this.options.timeoutSeconds,
    })
  );
}
```

Use the same pattern in `pipeline-governance.service.ts`.

- [x] **Step 3: Update tests**

Change existing tests to inject `athenaRunner` instead of `commandRunner`:

```ts
const athenaRunner = {
  run: jest.fn(async () => ({
    queryExecutionId: "query-1",
    outputLocation:
      "s3://api-center-athena-results/athena-results/platform/validation/test/query-1.csv",
    bytesScanned: 4096,
    rows: [
      {
        environment: "test",
        tribe_id: "codex-sdk-20260520041053",
        source_service_id: "codex-sdk-20260520041053-api",
        event_type: "codex.pipeline.flush",
        event_day: "2026-05-20",
        event_count: "1000",
        latest_occurred_at: "2026-05-20T09:41:45.721Z",
        latest_ingested_at: "2026-05-20 14:27:36.973 UTC",
      },
    ],
  })),
};
```

- [x] **Step 4: Run focused tests**

Run:

```powershell
npm test -- src/data-pipeline/athena-query-runner.spec.ts src/data-pipeline/pipeline-health.service.spec.ts src/data-pipeline/pipeline-governance.service.spec.ts --runInBand
```

Expected:

```text
All three suites pass.
```

### Task 1.4: Configure GKE For Live Athena Mode

**Files:**

- Modify: `api-center/gcp/gke/20-configmap.yaml`
- Modify: `api-center/docs/deployment-gke.md`
- Modify: `api-center/docs/data-pipeline/actual-pipeline-runbook.md`

- [x] **Step 1: Add non-secret config**

Add these keys to `api-center/gcp/gke/20-configmap.yaml`:

```yaml
  PIPELINE_HEALTH_SOURCE: "athena"
  PIPELINE_GOVERNANCE_SOURCE: "athena"
  PIPELINE_HEALTH_ATHENA_DATABASE: "gold_platform"
  PIPELINE_GOVERNANCE_ATHENA_DATABASE: "gold_platform"
  PIPELINE_HEALTH_QUERY_LIMIT: "100"
  PIPELINE_GOVERNANCE_QUERY_LIMIT: "100"
  AWS_REGION: "ap-southeast-2"
```

Do not set `PIPELINE_HEALTH_YEAR`, `PIPELINE_HEALTH_MONTH`, or `PIPELINE_HEALTH_DAY` in the ConfigMap. Those should default to the current UTC date so deployed dashboards do not get stuck on a stale partition.

- [x] **Step 2: Add secret requirement to docs**

In `api-center/docs/deployment-gke.md`, add:

```text
AWS credentials for APICenter Athena reads must be available to the API Center
runtime through the approved secret path. Required AWS permissions:

- athena:GetWorkGroup
- athena:StartQueryExecution
- athena:GetQueryExecution
- athena:GetQueryResults
- athena:StopQueryExecution
- glue:GetDatabase
- glue:GetDatabases
- glue:GetTable
- glue:GetTables
- glue:GetPartition
- glue:GetPartitions
- s3:GetBucketLocation on api-center-athena-results
- s3:GetObject, s3:PutObject, s3:DeleteObject on approved athena-results prefixes
```

- [x] **Step 3: Build and deploy**

Unblocked on 2026-05-21: created dedicated AWS runtime principal
`api-center-athena-reader-gke`, attached
`ApiCenterAthenaRuntimePolicy`, stored its access key in GCP Secret Manager
`api-center-prod` version 11, corrected `AWS_REGION` to `ap-southeast-2`, and
deployed image
`asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-athena-cancel-d1eb7e6-20260521152340`.

Evidence:

```text
cloud_build_id: 6df72593-0dbb-4e94-9fc7-ac54fcb739bb
rollout_status: deployment/api-center successfully rolled out
ready_replicas: 3/3
runtime_policy_default_version: v4
direct_runtime_athena_query_id: f0c85ef9-0729-4bad-aab7-de3b05fbf6a4
direct_runtime_athena_query_state: SUCCEEDED
review_fixes: added best-effort StopQueryExecution on local timeout and removed s3:DeleteObject from the runtime IAM policy
```

Run:

```powershell
gcloud builds submit `
  --tag asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-athena-sdk-<shortsha>-<timestamp> `
  .

kubectl -n api-center apply -f gcp/gke/20-configmap.yaml

kubectl -n api-center set image deployment/api-center `
  api-center=asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-athena-sdk-<shortsha>-<timestamp>

kubectl -n api-center rollout status deployment/api-center --timeout=10m
```

Expected:

```text
Cloud Build succeeds.
GKE rollout succeeds.
3/3 api-center pods are Running.
```

- [x] **Step 4: Smoke live Athena endpoints**

Run a secret-safe endpoint smoke:

```powershell
node -e "const fs=require('fs'); const env=fs.readFileSync('../apicenter-management/.env.live','utf8'); const secret=(env.match(/^API_CENTER_PLATFORM_ADMIN_SECRET=(.*)$/m)||[])[1]; if(!secret) throw new Error('missing platform secret'); Promise.all(['health','quality','shared-service-usage','gateway-decisions','cost'].map(async p=>{const r=await fetch('https://api-center.itsandbox.site/api/v1/data-pipeline/'+p+'?environment=test&year=2026&month=05&day=20',{headers:{'x-platform-secret':secret}}); const b=await r.json(); console.log(p, r.status, b.success, b.meta?.source, b.meta?.partition, Array.isArray(b.data)?b.data.length:'no-data', b.error||'');})).catch(e=>{console.error(e); process.exit(1);});"
```

Expected after credentials are correct:

```text
health 200 true athena-proxy <number>
quality 200 true athena-proxy <number>
shared-service-usage 200 true athena-proxy <number>
gateway-decisions 200 true athena-proxy <number>
cost 200 true athena-proxy 0
```

`cost` can remain `0` until Phase 2 telemetry is implemented.

Actual 2026-05-21 test smoke:

```text
health 200 true athena-proxy 0
quality 200 true athena-proxy 0
shared-service-usage 200 true athena-proxy 1
gateway-decisions 200 true athena-proxy 0
cost 200 true athena-proxy 0
```

**Phase 1 Exit Criteria:**

- Deployed API Center returns `meta.source=athena-proxy`.
- Health and quality rows return live Athena data for at least the validated test partition.
- No container dependency on AWS CLI remains for pipeline health/governance reads.

---

## Phase 2: Emit APICenter Athena Query-Execution Telemetry

**Purpose:** Populate `gold_platform.athena_query_cost_daily` with measured bytes scanned by workgroup, purpose, and day.

**Why second:** Cost dashboards should show measured Athena execution cost. The Gold view already exists, but it has no source events.

### Task 2.1: Define Telemetry Contract

**Files:**

- Create: `api-center/src/data-pipeline/athena-query-telemetry.service.ts`
- Create: `api-center/src/data-pipeline/athena-query-telemetry.service.spec.ts`

- [x] **Step 1: Write tests**

Create `api-center/src/data-pipeline/athena-query-telemetry.service.spec.ts`:

```ts
import { AthenaQueryTelemetryService } from "./athena-query-telemetry.service";

describe("AthenaQueryTelemetryService", () => {
  it("publishes query execution telemetry through the APICenter ops topic", async () => {
    const published: unknown[] = [];
    const service = new AthenaQueryTelemetryService({
      publisher: {
        publish: async (topic, event) => {
          published.push({ topic, event });
        },
      },
      topicPrefix: "test.",
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });

    await service.recordQueryExecution({
      environment: "test",
      workgroup: "api-center-platform-validation-test",
      resultPurpose: "platform-validation",
      queryExecutionId: "query-1",
      bytesScanned: 2048,
      completedAt: "2026-05-21T00:00:00.000Z",
    });

    expect(published).toEqual([
      {
        topic: "test.api-center.pipeline.athena-query-execution",
        event: expect.objectContaining({
          eventType: "athena.query.completed",
          sourceServiceId: "api-center",
          payload: expect.objectContaining({
            workgroup: "api-center-platform-validation-test",
            resultPurpose: "platform-validation",
            queryExecutionId: "query-1",
            bytesScanned: 2048,
            completedAt: "2026-05-21T00:00:00.000Z",
          }),
        }),
      },
    ]);
  });

  it("does not throw when publishing telemetry fails", async () => {
    const service = new AthenaQueryTelemetryService({
      publisher: {
        publish: async () => {
          throw new Error("kafka unavailable");
        },
      },
      topicPrefix: "test.",
      now: () => new Date("2026-05-21T00:00:00.000Z"),
    });

    await expect(
      service.recordQueryExecution({
        environment: "test",
        workgroup: "api-center-platform-validation-test",
        resultPurpose: "platform-validation",
        queryExecutionId: "query-1",
        bytesScanned: 2048,
        completedAt: "2026-05-21T00:00:00.000Z",
      }),
    ).resolves.toBeUndefined();
  });
});
```

- [x] **Step 2: Implement telemetry service**

Implementation note, 2026-05-21: the service publishes to the exact physical
topic for the requested environment:

```text
test.api-center.pipeline.athena-query-execution
prod.api-center.pipeline.athena-query-execution
```

It does not derive the target topic from the deployed `KAFKA_TOPIC_PREFIX`,
because the API Center GKE runtime may be configured with `prod.` while still
serving bounded test dashboard queries. Kafka publishing uses
`KafkaService.publishPhysicalTopic(...)` for this telemetry lane.

Create:

```ts
import { Injectable, Logger } from "@nestjs/common";

export type AthenaTelemetryPublisher = {
  publish(topic: string, event: Record<string, unknown>): Promise<void>;
};

export type AthenaQueryTelemetryOptions = {
  publisher: AthenaTelemetryPublisher;
  topicPrefix?: string;
  now?: () => Date;
};

export type AthenaQueryTelemetryInput = {
  environment: "test" | "prod";
  workgroup: string;
  resultPurpose: string;
  queryExecutionId: string;
  bytesScanned?: number;
  completedAt: string;
};

@Injectable()
export class AthenaQueryTelemetryService {
  private readonly logger = new Logger(AthenaQueryTelemetryService.name);
  private readonly now: () => Date;

  constructor(private readonly options: AthenaQueryTelemetryOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async recordQueryExecution(input: AthenaQueryTelemetryInput): Promise<void> {
    const topic = `${this.resolveTopicPrefix(input.environment)}api-center.pipeline.athena-query-execution`;
    const event = {
      eventType: "athena.query.completed",
      sourceServiceId: "api-center",
      payload: {
        workgroup: input.workgroup,
        resultPurpose: input.resultPurpose,
        queryExecutionId: input.queryExecutionId,
        bytesScanned: input.bytesScanned ?? 0,
        completedAt: input.completedAt,
        occurredAt: this.now().toISOString(),
      },
      metadata: {
        schemaVersion: "1.0.0",
      },
    };

    try {
      await this.options.publisher.publish(topic, event);
    } catch (error) {
      this.logger.warn(
        `Athena query telemetry publish failed: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }

  private resolveTopicPrefix(environment: "test" | "prod"): string {
    const configured = this.options.topicPrefix ?? process.env.KAFKA_TOPIC_PREFIX;
    if (configured) return configured.endsWith(".") ? configured : `${configured}.`;
    return `${environment}.`;
  }
}
```

- [x] **Step 3: Run tests**

Run:

```powershell
npm test -- src/data-pipeline/athena-query-telemetry.service.spec.ts --runInBand
```

Expected:

```text
PASS src/data-pipeline/athena-query-telemetry.service.spec.ts
```

### Task 2.2: Emit Telemetry From Athena Runner Calls

**Files:**

- Modify: `api-center/src/data-pipeline/athena-query-runner.ts`
- Modify: `api-center/src/data-pipeline/athena-query-runner.spec.ts`
- Modify: `api-center/src/data-pipeline/pipeline-health.service.ts`
- Modify: `api-center/src/data-pipeline/pipeline-governance.service.ts`

- [x] **Step 1: Extend runner result**

Ensure `AthenaQueryResult` includes:

```ts
queryExecutionId: string;
outputLocation?: string;
bytesScanned?: number;
completedAt: string;
```

Set `completedAt` from Athena completion time when available:

```ts
completedAt:
  execution.QueryExecution?.Status?.CompletionDateTime?.toISOString() ??
  new Date().toISOString()
```

- [x] **Step 2: Add telemetry callback to health/governance services**

Add optional service option:

```ts
athenaTelemetry?: {
  recordQueryExecution(input: {
    environment: PipelineHealthEnvironment;
    workgroup: string;
    resultPurpose: string;
    queryExecutionId: string;
    bytesScanned?: number;
    completedAt: string;
  }): Promise<void>;
};
```

After each successful Athena query, call:

```ts
await this.options.athenaTelemetry?.recordQueryExecution({
  environment,
  workgroup,
  resultPurpose: "platform-validation",
  queryExecutionId: result.queryExecutionId,
  bytesScanned: result.bytesScanned,
  completedAt: result.completedAt,
});
```

- [x] **Step 3: Verify telemetry is best-effort**

Add a test where `recordQueryExecution` rejects and assert the health/governance response still returns rows.

Expected assertion:

```ts
await expect(service.listHealth("test")).resolves.toHaveLength(1);
```

- [x] **Step 4: Run focused tests**

Run:

```powershell
npm test -- src/data-pipeline/athena-query-runner.spec.ts src/data-pipeline/pipeline-health.service.spec.ts src/data-pipeline/pipeline-governance.service.spec.ts src/data-pipeline/athena-query-telemetry.service.spec.ts --runInBand
```

Expected:

```text
All suites pass.
```

### Task 2.3: Catalog Parser And Cost Validation

**Files:**

- Modify: `api-center/infra/aws-data-pipeline/catalog/bronze-apicenter-ops-events.sql`
- Modify: `api-center/infra/aws-data-pipeline/catalog/gold-platform-governance.sql`
- Create: `api-center/infra/aws-data-pipeline/queries/validate-athena-query-cost.sql`

- [x] **Step 1: Ensure ops parser accepts telemetry topic**

In `bronze-apicenter-ops-events.sql`, confirm the existing parser resolves:

```text
test.api-center.pipeline.athena-query-execution
prod.api-center.pipeline.athena-query-execution
```

Expected `ops_stream`:

```text
pipeline.athena-query-execution
```

- [x] **Step 2: Keep cost Gold source aligned**

In `gold-platform-governance.sql`, keep:

```sql
WHERE event_type IN ('athena.query-executed', 'athena.query.completed')
   OR ops_stream IN ('athena.query-executed', 'athena.query.completed', 'pipeline.athena-query-execution')
```

- [x] **Step 3: Create validation query**

Create `api-center/infra/aws-data-pipeline/queries/validate-athena-query-cost.sql`:

```sql
SELECT
  environment,
  workgroup,
  result_purpose,
  event_day,
  query_count,
  bytes_scanned,
  estimated_cost_usd,
  latest_query_execution_id
FROM gold_platform.athena_query_cost_daily
WHERE environment = '${environment}'
  AND year = '${year}'
  AND month = '${month}'
  AND day = '${day}'
ORDER BY bytes_scanned DESC
LIMIT 50;
```

- [x] **Step 3b: Add telemetry topics to Athena projection**

Reviewer finding fixed on 2026-05-21: Kafka topic creation and S3 Sink inclusion
are not sufficient by themselves because `api_center_raw.topic_records` uses
Athena partition projection over an explicit physical-topic enum.

Added these projection values and regenerated
`infra/aws-data-pipeline/catalog/raw-topic-tables.sql`:

```text
test.api-center.pipeline.athena-query-execution
prod.api-center.pipeline.athena-query-execution
```

Verification:

```powershell
node .\scripts\data-pipeline\resolve-athena-topic-projection.js --check `
  -TopicsFile .\infra\aws-data-pipeline\topic-projection-values.txt `
  -RawTopicTablesSql .\infra\aws-data-pipeline\catalog\raw-topic-tables.sql `
  -ExpectedTopic test.api-center.pipeline.athena-query-execution `
  -ExpectedTopic prod.api-center.pipeline.athena-query-execution
```

Evidence:

```text
ok: true
topic_count: 65
errors: []
warnings: []
```

- [x] **Step 4: Apply catalog**

Run:

```powershell
.\scripts\data-pipeline\apply-athena-catalog.ps1 `
  -Environment test `
  -Workgroup api-center-platform-validation-test `
  -Profile apic `
  -Wait
```

Expected:

```text
All statements succeed.
```

Actual 2026-05-21:

```text
test catalog apply succeeded after telemetry projection update
```

- [ ] **Step 5: Trigger a dashboard query and validate cost row**

Call a live endpoint:

```powershell
node -e "const fs=require('fs'); const env=fs.readFileSync('../apicenter-management/.env.live','utf8'); const secret=(env.match(/^API_CENTER_PLATFORM_ADMIN_SECRET=(.*)$/m)||[])[1]; fetch('https://api-center.itsandbox.site/api/v1/data-pipeline/quality?environment=test',{headers:{'x-platform-secret':secret}}).then(r=>r.json()).then(console.log)"
```

Then run:

```powershell
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\validate-athena-query-cost.sql `
  -Database api_center_raw `
  -Workgroup api-center-platform-validation-test `
  -Profile apic `
  -Environment test `
  -ResultPurpose platform-validation `
  -Parameters @{ environment = "test"; year = "<yyyy>"; month = "<mm>"; day = "<dd>" } `
  -Wait
```

Expected:

```text
At least one row appears after the telemetry event has flushed to S3 and the projected partition is visible.
bytes_scanned is greater than or equal to 0.
latest_query_execution_id is present.
```

**Phase 2 Exit Criteria:**

- [x] API Center emits Athena query telemetry without breaking dashboard reads.
- [x] Cost Gold row appears after a live query and S3 Sink flush.
- [x] `/api/v1/data-pipeline/cost?environment=test` returns measured rows.

Evidence:

```text
route_smoke_cost: cost 200 true athena-proxy 5
cost_validation_query_id: 410bcea0-a1e2-4682-8a47-f880aff6d3b8
cost_validation_rows: 5 measured rows
```

Resolved blocker:

```text
The reviewer found that Kafka/S3 Sink provisioning was not enough because
Athena projection omitted the telemetry topics. The projection enum now includes
test.api-center.pipeline.athena-query-execution and
prod.api-center.pipeline.athena-query-execution, the catalog was reapplied, and
Gold cost rows are visible in test.
```

---

## Phase 3: Add Durable Feedback Action Contracts

**Purpose:** Add write-safe operator feedback actions with durable state and auditability.

**Why third:** UI actions should not mutate pipeline state until the write contract is explicit.

### Task 3.1: Define Feedback Action Contract

**Files:**

- Create: `api-center/docs/data-pipeline/pipeline-feedback-action-contract.md`
- Create: `api-center/src/data-pipeline/pipeline-feedback.dto.ts`

- [x] **Step 1: Create contract doc**

Create `pipeline-feedback-action-contract.md`:

```markdown
# Pipeline Feedback Action Contract

APICenter supports these feedback actions:

| Action | Purpose | Required fields | Mutation |
| --- | --- | --- | --- |
| `validation.rerun.requested` | Ask an operator/job to rerun bounded validation | environment, targetType, targetId, reason | Creates pending feedback record |
| `evidence.reviewed` | Mark evidence reviewed | environment, targetType, targetId, evidenceLink, reason | Creates reviewed feedback record |
| `decision.false_positive.marked` | Mark decision signal false positive | environment, targetType=signal, targetId, evidenceLink, reason | Creates closed feedback record |
| `onboarding.state.opened` | Open onboarding state record | environment, targetType, targetId | Read/link action only |
| `promotion.blocked` | Block promotion | environment, targetType, targetId, reason | Creates blocking feedback record |
| `schema.fix.requested` | Request tribe schema fix | environment, targetType, targetId, ownerTribeId, reason | Creates pending fix request |

All writes require:

- actor id or email
- actor role
- reason
- createdAt
- correlationId
- no raw S3 payloads
```

- [x] **Step 2: Create DTO**

Create `pipeline-feedback.dto.ts`:

```ts
import { IsIn, IsOptional, IsString, Matches } from "class-validator";

export const PIPELINE_FEEDBACK_ACTIONS = [
  "validation.rerun.requested",
  "evidence.reviewed",
  "decision.false_positive.marked",
  "onboarding.state.opened",
  "promotion.blocked",
  "schema.fix.requested",
] as const;

export type PipelineFeedbackAction =
  (typeof PIPELINE_FEEDBACK_ACTIONS)[number];

export class PipelineFeedbackActionDto {
  @IsIn(PIPELINE_FEEDBACK_ACTIONS)
  action!: PipelineFeedbackAction;

  @IsIn(["test", "prod"])
  environment!: "test" | "prod";

  @IsIn(["topic", "tribe", "service", "event", "signal", "query"])
  targetType!: "topic" | "tribe" | "service" | "event" | "signal" | "query";

  @IsString()
  @Matches(/^[a-zA-Z0-9._:/-]+$/)
  targetId!: string;

  @IsOptional()
  @IsString()
  ownerTribeId?: string;

  @IsOptional()
  @IsString()
  evidenceLink?: string;

  @IsString()
  reason!: string;
}
```

### Task 3.2: Implement Feedback Service And Controller

**Files:**

- Create: `api-center/src/data-pipeline/pipeline-feedback.service.ts`
- Create: `api-center/src/data-pipeline/pipeline-feedback.service.spec.ts`
- Create: `api-center/src/data-pipeline/pipeline-feedback.controller.ts`
- Modify: `api-center/src/data-pipeline/data-pipeline.module.ts`

- [x] **Step 1: Write service tests**

Create tests for:

```text
creates a feedback record with actor, role, reason, and timestamp
rejects prod promotion.blocked without non-empty reason
lists records filtered by environment and targetId
```

Use an in-memory store first:

```ts
const service = new PipelineFeedbackService({
  now: () => new Date("2026-05-21T00:00:00.000Z"),
});
```

- [x] **Step 2: Implement in-memory contract store**

Start with in-process records so the API/UI contract is testable:

```ts
type PipelineFeedbackRecord = {
  id: string;
  action: PipelineFeedbackAction;
  environment: "test" | "prod";
  targetType: string;
  targetId: string;
  ownerTribeId?: string;
  evidenceLink?: string;
  reason: string;
  actorId: string;
  actorRole: string;
  createdAt: string;
  status: "pending" | "reviewed" | "blocking" | "closed";
};
```

Map statuses:

```text
validation.rerun.requested -> pending
evidence.reviewed -> reviewed
onboarding.state.opened -> reviewed
promotion.blocked -> blocking
schema.fix.requested -> pending
```

- [x] **Step 3: Add controller routes**

Routes:

```text
POST /api/v1/data-pipeline/feedback-actions
GET /api/v1/data-pipeline/feedback-actions?environment=test&targetId=...
```

Controller uses `ScopedAdminGuard`.

Request:

```json
{
  "action": "promotion.blocked",
  "environment": "prod",
  "targetType": "topic",
  "targetId": "prod.tribe.logistics.events",
  "ownerTribeId": "logistics",
  "reason": "Quality error count exceeded threshold"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "pfb_...",
    "status": "blocking"
  }
}
```

- [x] **Step 4: Run tests**

Run:

```powershell
npm test -- src/data-pipeline/pipeline-feedback.service.spec.ts --runInBand
npm run typecheck
```

Expected:

```text
Feedback tests pass and typecheck passes.
```

### Task 3.3: Add Management Feedback Controls

**Files:**

- Modify: `apicenter-management/src/lib/schemas.ts`
- Modify: `apicenter-management/src/lib/api-center-client.ts`
- Create: `apicenter-management/src/components/data-pipeline-feedback-actions.tsx`
- Modify: `apicenter-management/src/components/data-pipeline-governance-panel.tsx`
- Modify: `apicenter-management/src/components/data-pipeline-health-panel.tsx`

- [x] **Step 1: Add schemas**

Add:

```ts
export const pipelineFeedbackActionSchema = z.enum([
  "validation.rerun.requested",
  "evidence.reviewed",
  "decision.false_positive.marked",
  "onboarding.state.opened",
  "promotion.blocked",
  "schema.fix.requested",
]);

export const pipelineFeedbackActionRequestSchema = z.object({
  action: pipelineFeedbackActionSchema,
  environment: pipelineHealthEnvironmentSchema,
  targetType: z.enum(["topic", "tribe", "service", "event", "signal", "query"]),
  targetId: z.string(),
  ownerTribeId: z.string().optional(),
  evidenceLink: z.string().optional(),
  reason: z.string().min(1),
});
```

- [x] **Step 2: Add client method**

Add:

```ts
export async function createPipelineFeedbackAction(
  input: PipelineFeedbackActionRequest,
) {
  const payload = pipelineFeedbackActionRequestSchema.parse(input);
  const data = await request<unknown>("/api/local/data-pipeline/feedback-actions", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  return pipelineFeedbackActionResponseSchema.parse(data).data;
}
```

- [x] **Step 3: Add action component**

Create `data-pipeline-feedback-actions.tsx` with:

```text
buttons:
  - Re-run validation
  - Mark reviewed
  - Block promotion
  - Request schema fix

inputs:
  - reason textarea for all write actions
  - disabled state until reason is non-empty
  - live/prod visual warning for promotion.blocked
```

- [x] **Step 4: Wire to health/governance panels**

Add actions at row level:

```text
quality row with qualityErrorCount > 0:
  - Request schema fix
  - Block promotion

stale health row:
  - Re-run validation
  - Mark reviewed

gateway denied row:
  - Mark reviewed
  - Block promotion
```

- [x] **Step 5: Verify management**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npx tsc --noEmit
npm test -- src/lib/server/pipeline-governance-provider.test.ts src/components/data-pipeline-health-panel.test.tsx
```

Expected:

```text
Typecheck passes.
Focused Vitest suites pass.
```

**Phase 3 Exit Criteria:**

- [x] Feedback action contract is documented.
- [x] APICenter accepts and lists feedback action records.
- [x] Management can create feedback records with explicit reason.
- [x] Production blockers are represented as durable records, not transient UI state.

Durability evidence:

```text
table: api_center_ops.pipeline_feedback_actions
migrations:
  - prisma/migrations/20260521172000_add_pipeline_feedback_actions/migration.sql
  - prisma/migrations/20260521180500_add_pipeline_feedback_correlation_id/migration.sql
deployed_image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-feedback-durable-reviewfix-d1eb7e6-20260521175948
cloud_build_id: 8451ea31-4885-4a60-b99c-a66b3b3fea34
api_smoke: POST 201 reviewed 5206456c-fa75-4730-b625-c843a07ad216; GET 200 found=true; correlationId=corr_phase9_reviewfix_smoke
postgres_smoke: rows=1, environment=test, status=reviewed, correlationId=corr_phase9_reviewfix_smoke, targetId=test.api-center.pipeline.athena-query-execution
reviewer_fix: durable mode fails closed instead of writing memory records when DATABASE_ENABLED=true and PrismaService is unavailable
```

---

## Phase 4: End-To-End Deployment And Evidence

**Purpose:** Prove the blockers are fixed in test before enabling prod dashboard reliance.

### Task 4.1: Deploy API Center And Apply Catalog

**Files:**

- Modify: `api-center/docs/deployment-gke.md`
- Modify: `api-center/docs/data-pipeline/actual-pipeline-runbook.md`

- [x] **Step 1: Build image**

Run:

```powershell
cd C:\Codes\apic\api-center
gcloud builds submit `
  --tag asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-blockers-fixed-<shortsha>-<timestamp> `
  .
```

- [x] **Step 2: Deploy**

Run:

```powershell
kubectl -n api-center apply -f gcp/gke/20-configmap.yaml
kubectl -n api-center set image deployment/api-center `
  api-center=asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-blockers-fixed-<shortsha>-<timestamp>
kubectl -n api-center rollout status deployment/api-center --timeout=10m
```

- [x] **Step 3: Apply test catalog**

Run:

```powershell
.\scripts\data-pipeline\apply-athena-catalog.ps1 `
  -Environment test `
  -Workgroup api-center-platform-validation-test `
  -Profile apic `
  -Wait
```

### Task 4.2: Verify Live Dashboard Rows

- [x] **Step 1: Run route smoke**

Run:

```powershell
node -e "const fs=require('fs'); const env=fs.readFileSync('../apicenter-management/.env.live','utf8'); const secret=(env.match(/^API_CENTER_PLATFORM_ADMIN_SECRET=(.*)$/m)||[])[1]; if(!secret) throw new Error('missing platform secret'); Promise.all(['health','quality','shared-service-usage','gateway-decisions','cost'].map(async p=>{const r=await fetch('https://api-center.itsandbox.site/api/v1/data-pipeline/'+p+'?environment=test&year=2026&month=05&day=20',{headers:{'x-platform-secret':secret}}); const b=await r.json(); console.log(p, r.status, b.success, b.meta?.source, b.meta?.partition, Array.isArray(b.data)?b.data.length:'no-data', b.error||'');})).catch(e=>{console.error(e); process.exit(1);});"
```

Expected:

```text
health 200 true athena-proxy >=1
quality 200 true athena-proxy >=1
shared-service-usage 200 true athena-proxy >=0
gateway-decisions 200 true athena-proxy >=0
cost 200 true athena-proxy >=0
```

- [x] **Step 2: Validate cost after telemetry flush**

Wait until the S3 Sink hourly or flush-size rule writes the ops telemetry event. Then run:

```powershell
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\validate-athena-query-cost.sql `
  -Database api_center_raw `
  -Workgroup api-center-platform-validation-test `
  -Profile apic `
  -Environment test `
  -ResultPurpose platform-validation `
  -Parameters @{ environment = "test"; year = "<yyyy>"; month = "<mm>"; day = "<dd>" } `
  -Wait
```

Expected:

```text
At least one cost row for api-center-platform-validation-test.
```

### Task 4.3: Update Plan And Runbook Evidence

**Files:**

- Modify: `api-center/docs/superpowers/plans/2026-05-20-apicenter-total-data-pipeline-phased-plan.md`
- Modify: `api-center/docs/data-pipeline/actual-pipeline-runbook.md`
- Modify: `api-center/docs/deployment-gke.md`

- [x] **Step 1: Record evidence**

Add:

```text
image: asia-southeast1-docker.pkg.dev/api-center-496422/api-center/api-center:data-pipeline-partition-override-d1eb7e6-20260521203007
cloud_build_id: 7b812838-d455-452e-872f-261499a52555
rollout_status: deployment/api-center successfully rolled out
route_smoke: health, quality, shared-service-usage, gateway-decisions, and cost returned HTTP 200 success=true source=athena-proxy for environment=test and environment=prod with year=2026&month=05&day=20
test_health_row_count: 1
test_quality_row_count: 1
test_shared_service_usage_row_count: 14
test_gateway_decision_row_count: 0
test_cost_row_count: 0
prod_health_row_count: 1
prod_quality_row_count: 1
prod_shared_service_usage_row_count: 0
prod_gateway_decision_row_count: 0
prod_cost_row_count: 0
cost_query_id: 410bcea0-a1e2-4682-8a47-f880aff6d3b8
feedback_action_smoke: POST 201 reviewed 5206456c-fa75-4730-b625-c843a07ad216; GET 200 found=true; direct Postgres rows=1 with correlationId=corr_phase9_reviewfix_smoke
partition_override: API Center and management now forward optional year/month/day filters while defaulting to current UTC when omitted
management_validation: focused tests passed 19/19; npx tsc --noEmit passed; npm run build passed with one Turbopack tracing warning for the local-file provider fallback
management_prod_feedback_smoke: local management route POST /api/local/data-pipeline/feedback-actions created prod evidence.reviewed aef1a203-5b39-411f-9aff-fe76a4c92456 and GET found it for targetId=order.created
review_agent: Boole reviewed durable feedback; medium findings fixed and redeployed. Ohm reviewed Phase 4 and found health/quality route evidence stale; partition override fixed that finding.
```

- [x] **Step 2: Mark blockers fixed**

Update the current blocker section from:

```text
blocked
```

to:

```text
fixed_with_evidence
```

only after the commands above pass.

**Phase 4 Exit Criteria:**

- Live API Center returns successful Athena-backed health and quality route responses.
- Athena query cost telemetry is visible in Gold after flush.
- Feedback action write path has a safe durable contract.
- Docs contain exact deployment/query evidence.

---

## Phase 5: Prod Enablement Gate

**Purpose:** Enable prod dashboard reliance only after test evidence proves the fixed path.

### Task 5.1: Prod Dry Run

- [x] **Step 1: Run prod route smoke**

Run:

```powershell
node -e "const fs=require('fs'); const env=fs.readFileSync('../apicenter-management/.env.live','utf8'); const secret=(env.match(/^API_CENTER_PLATFORM_ADMIN_SECRET=(.*)$/m)||[])[1]; if(!secret) throw new Error('missing platform secret'); Promise.all(['health','quality','shared-service-usage','gateway-decisions','cost'].map(async p=>{const r=await fetch('https://api-center.itsandbox.site/api/v1/data-pipeline/'+p+'?environment=prod&year=2026&month=05&day=20',{headers:{'x-platform-secret':secret}}); const b=await r.json(); console.log(p, r.status, b.success, b.meta?.source, b.meta?.partition, Array.isArray(b.data)?b.data.length:'no-data', b.error||'');})).catch(e=>{console.error(e); process.exit(1);});"
```

Expected:

```text
health 200 true athena-proxy >=1
quality 200 true athena-proxy >=1
shared-service-usage 200 true athena-proxy >=0
gateway-decisions 200 true athena-proxy >=0
cost 200 true athena-proxy >=0
```

Evidence from 2026-05-21 against the populated `2026-05-20` partition:

```text
prod health 200 true athena-proxy 2026-05-20 1
prod quality 200 true athena-proxy 2026-05-20 1
prod shared-service-usage 200 true athena-proxy 2026-05-20 0
prod gateway-decisions 200 true athena-proxy 2026-05-20 0
prod cost 200 true athena-proxy 2026-05-20 0
```

- [x] **Step 2: Run prod leak guard**

Run:

```powershell
.\scripts\data-pipeline\run-athena-query.ps1 `
  -QueryFile .\infra\aws-data-pipeline\queries\validate-environment-leak-guard.sql `
  -Database api_center_raw `
  -Workgroup api-center-platform-validation-prod `
  -Profile apic `
  -Environment prod `
  -ResultPurpose platform-validation `
  -Parameters @{ environment = "prod"; year = "<yyyy>"; month = "<mm>"; day = "<dd>" } `
  -Wait
```

Expected:

```text
leaked_environment_count = 0
```

Evidence:

```text
query_execution_id: 37dcfed2-432f-415f-8b52-ac32c34fc7d8
state: SUCCEEDED
environment: prod
physical_topic: prod.tribe.logistics.events
partition: year=2026 month=05 day=20 hour=18
leaked_environment_count: 0
checked_record_count: 1000
```

### Task 5.2: Management Prod Review

- [x] **Step 1: Open `/data-pipeline` in management**

Expected:

```text
Test selector returns test rows.
Prod selector returns prod rows.
No raw S3 links are exposed.
Cost panel says when telemetry is not yet flushed.
```

Evidence:

```text
management_partition_control: /data-pipeline has a date input that sends year/month/day to all data-pipeline client calls.
local_route_forwarding: provider tests verify year/month/day are forwarded to APICenter.
local_management_route_smoke:
  management-prod health success=True source=athena-proxy partition=2026-05-20 count=1
  management-prod quality success=True source=athena-proxy partition=2026-05-20 count=1
  management-prod shared-service-usage success=True source=athena-proxy partition=2026-05-20 count=0
  management-prod gateway-decisions success=True source=athena-proxy partition=2026-05-20 count=0
  management-prod cost success=True source=athena-proxy partition=2026-05-20 count=0
ui_assertion_tests:
  - DataPipelineHealthPanel does not render raw S3 evidence keys.
  - DataPipelineCostPanel explains empty cost rows as not-yet-exported Athena query telemetry.
focused_tests: 5 files passed, 19 tests passed.
typecheck: npx tsc --noEmit passed.
build: npm run build passed; Turbopack reported one tracing warning for the local-file provider fallback.
```

- [x] **Step 2: Open logistics service detail**

Expected:

```text
Test/Prod selector exists.
Prod health shows logistics rows.
Cost panel is labeled platform-wide.
```

Evidence:

```text
service_detail_partition_control: service detail Observability has a date input and forwards partition filters to health, quality, shared-service usage, gateway decision, and cost queries.
prod_route_smoke_source: API Center prod health returned a live logistics row from the 2026-05-20 partition.
prod_feedback_smoke_from_management: local management route created reviewed feedback record aef1a203-5b39-411f-9aff-fe76a4c92456 for environment=prod, targetId=order.created, ownerTribeId=logistics; GET returned found=1.
management_build: route /tribes/[tribeId] compiled successfully during npm run build.
```

**Phase 5 Exit Criteria:**

- Prod dashboard reads only prod workgroup/result prefixes.
- No test/prod leakage.
- Operators can review prod evidence and feedback actions from management.

---

## Verification Matrix

| Area | Command |
| --- | --- |
| API Center Athena runtime tests | `npm test -- src/data-pipeline/athena-query-runner.spec.ts src/data-pipeline/pipeline-health.service.spec.ts src/data-pipeline/pipeline-governance.service.spec.ts --runInBand` |
| Telemetry tests | `npm test -- src/data-pipeline/athena-query-telemetry.service.spec.ts --runInBand` |
| Feedback tests | `npm test -- src/data-pipeline/pipeline-feedback.service.spec.ts --runInBand` |
| API Center typecheck | `npm run typecheck` |
| Catalog dry-run | `.\scripts\data-pipeline\apply-athena-catalog.ps1 -Environment test -Workgroup api-center-platform-validation-test -Profile apic -DryRun` |
| Catalog apply | `.\scripts\data-pipeline\apply-athena-catalog.ps1 -Environment test -Workgroup api-center-platform-validation-test -Profile apic -Wait` |
| Management typecheck | `cd C:\Codes\apic\apicenter-management; npx tsc --noEmit` |
| Management focused tests | `cd C:\Codes\apic\apicenter-management; npm test -- src/lib/server/pipeline-governance-provider.test.ts src/app/api/local/data-pipeline/health/route.test.ts` |
| GKE rollout | `kubectl -n api-center rollout status deployment/api-center --timeout=10m` |
| Live route smoke | Node fetch script in Phase 4 |

## Definition Of Done

This blocker-fix plan is complete when:

- API Center deployed in GKE reads Athena through AWS SDK, not AWS CLI.
- Pipeline health and governance endpoints return `meta.source=athena-proxy` with live rows.
- Athena query-cost Gold populates from APICenter query telemetry.
- Management `/data-pipeline` and service detail can review test and prod.
- Feedback actions persist reviewed/block/fix-request state with actor, reason, and evidence.
- Test/prod isolation is validated after every live change.
- Docs include exact build, rollout, query, and smoke evidence.

## Open Risks

| Risk | Mitigation |
| --- | --- |
| AWS credentials in GKE are missing or too broad | Use least-privilege Athena/Glue/S3 policy and validate with route smoke before relying on dashboard rows. |
| Athena SDK reads broad partitions | Keep service queries bounded by current UTC `year`, `month`, `day`, and `LIMIT`. |
| Cost telemetry creates a feedback loop | Emit telemetry best-effort and ignore telemetry publish failures so dashboards do not fail. |
| S3 Sink delay makes cost rows appear late | Document flush-size/hourly behavior and validate after connector flush. |
| Feedback actions mutate too much too early | Start with durable records only; do not auto-change onboarding or promotion state until explicit state transitions are implemented. |
| Prod dashboard reads test rows | Keep env-specific workgroups and run leak guard before prod reliance. |
