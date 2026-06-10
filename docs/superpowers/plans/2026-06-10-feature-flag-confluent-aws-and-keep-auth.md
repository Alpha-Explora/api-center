# Feature Flag Confluent AWS And Keep Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let APICenter run authentication, registry, policy, quotas, and proxying without Confluent Cloud or AWS S3, while keeping the Confluent/AWS data pipeline code behind explicit feature flags for later reactivation.

**Architecture:** APICenter keeps the synchronous request path always available: tribe backend requests an APICenter token, sends `Authorization: Bearer <token>`, APICenter validates scopes and registry access, then proxies to tribe/shared services. The asynchronous event/data path becomes optional: Kafka/Confluent/S3 publishing, topic provisioning, S3 sink checks, Athena/raw-data health, and data-pipeline UI actions are disabled unless `DATA_PIPELINE_ENABLED=true`. Disabled mode must be quiet, intentional, and observable.

**Tech Stack:** NestJS, TypeScript, Jest, KafkaJS, GCP Secret Manager optional fallback, APICenter Management Next.js, Vitest/React Testing Library, Markdown runbooks.

---

## Current Dependency Boundary

The codebase already separates the two paths enough to do this safely:

- Auth and proxying are owned by `api-center/src/auth`, `api-center/src/registry`, and `api-center/src/shared/proxy-handler.ts`.
- Tribe credential verification already supports non-GCP env hashes through `TRIBE_SECRET_<SERVICE_ID_UPPER_SNAKE>` in `api-center/src/registry/tribe-secret-resolver.service.ts`.
- Kafka event publishing is mostly nonblocking for request-path audit events, but `KafkaService` still attempts to connect at startup and some config validation assumes Confluent in production.
- Data-pipeline features in `api-center/src/data-pipeline` and `apicenter-management/src/components/*confluent*` assume the pipeline is available.

## Feature Flags

Use these flags:

```env
# Keep core APICenter auth/proxy enabled.
AUTH_PROVIDER=internal-jwt

# Disable Confluent/AWS-backed features for now.
DATA_PIPELINE_ENABLED=false
KAFKA_ENABLED=false

# Keep GCP Secret Manager optional. If this is not set to gcp-secret-manager,
# APICenter validates tribe secrets from TRIBE_SECRET_<SERVICE_ID_UPPER_SNAKE>.
# TRIBE_SECRET_SOURCE=
```

Flag semantics:

- `DATA_PIPELINE_ENABLED=false`: hide/disable data-pipeline API surfaces and management UI operations that require Confluent, S3, Athena, Glue, or raw-data evidence.
- `KAFKA_ENABLED=false`: `KafkaService` does not connect, `publish()` rejects with a clear disabled error for explicit publish endpoints, and `publishNonBlocking()` logs once at debug level then no-ops.
- `DATA_PIPELINE_ENABLED=true`: require real Kafka/Confluent config when the app runs in production.
- `KAFKA_ENABLED=true`: allow `KafkaService` to connect and publish.

## File Structure

### `api-center`

- Modify `api-center/src/config/config.service.ts`
  - Add `dataPipeline.enabled`.
  - Add `kafka.enabled`.
  - Change production Kafka validation so Confluent config is required only when `DATA_PIPELINE_ENABLED=true` or `KAFKA_ENABLED=true`.

- Modify `api-center/src/config/config.service.spec.ts`
  - Cover production boot with pipeline disabled and no Kafka brokers.
  - Cover production boot with pipeline enabled and missing/invalid Confluent config.

- Modify `api-center/src/kafka/kafka.service.ts`
  - Make disabled mode skip producer creation/connect/disconnect.
  - Make explicit `publish()` and `publishPhysicalTopic()` fail with `Kafka publishing is disabled`.
  - Make `publishNonBlocking()` no-op without request-path noise.

- Modify `api-center/src/kafka/kafka.service.spec.ts`
  - Cover no Kafka client construction/connect when disabled.
  - Cover no-op nonblocking publish when disabled.
  - Cover explicit publish rejection when disabled.

- Modify `api-center/src/data-pipeline/data-pipeline.module.ts`
  - Inject disabled publisher options when `DATA_PIPELINE_ENABLED=false`.
  - Keep module importable so unrelated controllers/services do not crash.

- Create `api-center/src/data-pipeline/data-pipeline-disabled.error.ts`
  - Export one reusable error helper for disabled explicit pipeline operations.

- Modify targeted data-pipeline controller/service tests, starting with:
  - `api-center/src/data-pipeline/athena-query-telemetry.service.spec.ts`
  - `api-center/src/data-pipeline/pipeline-health.service.spec.ts`
  - `api-center/src/data-pipeline/pipeline-governance.service.spec.ts`

- Modify `api-center/.env.example`
  - Document `DATA_PIPELINE_ENABLED=false` and `KAFKA_ENABLED=false` as the temporary no-Confluent/no-AWS mode.
  - Keep Confluent placeholders under a clearly labeled "only when enabled" section.

- Modify `api-center/docs/developer/README.md`
  - Add a "Core Gateway Without Data Pipeline" section.
  - Clarify that tribe auth does not require Confluent/AWS.

- Modify `api-shared-services/docs/consumer-runbook.md`
  - Mark S3 export as optional/disabled until platform enables `DATA_PIPELINE_ENABLED=true`.
  - Keep SDK auth instructions unchanged.

### `apicenter-management`

- Modify `apicenter-management/.env.example`
  - Add `NEXT_PUBLIC_DATA_PIPELINE_ENABLED=false` or server-only `DATA_PIPELINE_ENABLED=false` depending on existing env usage.

- Create or modify `apicenter-management/src/lib/feature-flags.ts`
  - Centralize management UI feature flags.

- Modify `apicenter-management/src/components/app-shell.tsx`
  - Hide or badge the Data Pipeline navigation when disabled.

- Modify `apicenter-management/src/components/confluent-provisioning-card.tsx`
  - Render a disabled state instead of calling Confluent routes.

- Modify `apicenter-management/src/components/confluent-pipeline-status-panel.tsx`
  - Render "Data pipeline disabled" instead of failing requests.

- Modify `apicenter-management/src/components/tribe-onboarding-flow.tsx`
  - Keep registration and secret/token steps visible.
  - Mark Confluent topic and S3 sink steps as skipped when disabled.

- Modify or add tests:
  - `apicenter-management/src/lib/feature-flags.test.ts`
  - `apicenter-management/src/components/app-shell.test.tsx`
  - `apicenter-management/src/components/confluent-provisioning-card.test.tsx`
  - `apicenter-management/src/components/tribe-onboarding-flow.test.tsx`

---

## Phase 1: Backend Feature Flags And Config Validation

### Task 1: Add Backend Flags To ConfigService

**Files:**
- Modify: `api-center/src/config/config.service.ts`
- Test: `api-center/src/config/config.service.spec.ts`

- [ ] **Step 1: Write failing config tests**

Add these tests to `api-center/src/config/config.service.spec.ts`:

```ts
it("should allow production core gateway mode without Kafka when data pipeline is disabled", () => {
  setValidProductionEnv();
  process.env.AUTH_PROVIDER = "internal-jwt";
  process.env.JWT_PRIVATE_KEY = "private-key";
  process.env.JWT_PUBLIC_KEY = "public-key";
  process.env.DATA_PIPELINE_ENABLED = "false";
  process.env.KAFKA_ENABLED = "false";
  process.env.KAFKA_BROKERS = "";
  process.env.KAFKA_SSL_ENABLED = "false";
  process.env.KAFKA_SASL_MECHANISM = "";
  process.env.KAFKA_SASL_USERNAME = "";
  process.env.KAFKA_SASL_PASSWORD = "";

  const config = new ConfigService();
  const run = () => config.onApplicationBootstrap();

  expect(run).not.toThrow();
  expect(config.dataPipeline.enabled).toBe(false);
  expect(config.kafka.enabled).toBe(false);
});

it("should require Confluent config in production when data pipeline is enabled", () => {
  setValidProductionEnv();
  process.env.DATA_PIPELINE_ENABLED = "true";
  process.env.KAFKA_ENABLED = "true";
  process.env.KAFKA_BROKERS = "";

  const run = () => new ConfigService().onApplicationBootstrap();

  expect(run).toThrow("KAFKA_BROKERS must be set when Kafka publishing is enabled");
});
```

- [ ] **Step 2: Run config tests and verify failure**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/config/config.service.spec.ts
```

Expected: fail because `config.dataPipeline` and `config.kafka.enabled` do not exist and production still requires Kafka unconditionally.

- [ ] **Step 3: Implement config flags**

In `api-center/src/config/config.service.ts`, add:

```ts
readonly dataPipeline = {
  enabled: process.env.DATA_PIPELINE_ENABLED === "true",
};

readonly kafka = {
  enabled:
    process.env.KAFKA_ENABLED === "true" ||
    process.env.DATA_PIPELINE_ENABLED === "true",
  clientId: process.env.KAFKA_CLIENT_ID || "api-center",
  topicPrefix: process.env.KAFKA_TOPIC_PREFIX || "",
  brokers: (process.env.KAFKA_BROKERS || "")
    .split(",")
    .map((broker) => broker.trim())
    .filter(Boolean),
  groupId: process.env.KAFKA_GROUP_ID || "api-center-group",
  sslEnabled: process.env.KAFKA_SSL_ENABLED === "true",
  sslRejectUnauthorized:
    process.env.KAFKA_SSL_REJECT_UNAUTHORIZED !== "false",
  sslCaPem: process.env.KAFKA_SSL_CA_PEM || "",
  saslMechanism: process.env.KAFKA_SASL_MECHANISM || "",
  saslUsername: process.env.KAFKA_SASL_USERNAME || "",
  saslPassword: process.env.KAFKA_SASL_PASSWORD || "",
};
```

Replace the production Kafka validation block with logic gated by `this.kafka.enabled`:

```ts
if (this.isProduction && this.kafka.enabled) {
  const hasLocalOrSelfManagedBroker = this.kafka.brokers.some((broker) => {
    const normalizedBroker = broker.toLowerCase();
    return (
      normalizedBroker.includes("localhost") ||
      normalizedBroker.includes("kafka:") ||
      normalizedBroker.includes("api-center-kafka") ||
      normalizedBroker.includes(".svc.cluster.local")
    );
  });
  const allBrokersAreConfluentCloud = this.kafka.brokers.every((broker) =>
    /^[a-z0-9-]+(\.[a-z0-9-]+)*\.confluent\.cloud:9092$/i.test(broker),
  );

  if (this.kafka.brokers.length === 0) {
    errors.push("KAFKA_BROKERS must be set when Kafka publishing is enabled");
  } else if (hasLocalOrSelfManagedBroker || !allBrokersAreConfluentCloud) {
    errors.push("KAFKA_BROKERS must point to Confluent Cloud when Kafka publishing is enabled");
  }

  if (!this.kafka.sslEnabled) {
    errors.push("KAFKA_SSL_ENABLED=true is required when Kafka publishing is enabled");
  }

  if (this.kafka.saslMechanism !== "plain") {
    errors.push("KAFKA_SASL_MECHANISM=plain is required when Kafka publishing is enabled");
  }
}
```

- [ ] **Step 4: Update older Kafka validation tests**

Existing tests that expect unconditional production Kafka failures should explicitly set:

```ts
process.env.DATA_PIPELINE_ENABLED = "true";
process.env.KAFKA_ENABLED = "true";
```

Then update expected strings to the new "when Kafka publishing is enabled" messages.

- [ ] **Step 5: Run config tests**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/config/config.service.spec.ts
```

Expected: all config tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/config/config.service.ts src/config/config.service.spec.ts
git commit -m "feat(api-center): gate Kafka config behind data pipeline flags"
```

---

## Phase 2: Kafka Disabled Mode

### Task 2: Make KafkaService Optional At Runtime

**Files:**
- Modify: `api-center/src/kafka/kafka.service.ts`
- Test: `api-center/src/kafka/kafka.service.spec.ts`

- [ ] **Step 1: Write failing Kafka disabled tests**

Add tests to `api-center/src/kafka/kafka.service.spec.ts`:

```ts
it("should not connect the producer when Kafka is disabled", async () => {
  (mockConfig.kafka as { enabled?: boolean }).enabled = false;
  service = new KafkaService(mockConfig, mockLogger, mockMetrics);

  await service.onModuleInit();

  expect(service.isConnected()).toBe(false);
  expect(mockMetrics.setKafkaProducerConnected).toHaveBeenCalledWith(false);
});

it("should reject explicit publish when Kafka is disabled", async () => {
  (mockConfig.kafka as { enabled?: boolean }).enabled = false;
  service = new KafkaService(mockConfig, mockLogger, mockMetrics);

  await expect(service.publish("custom.topic", { event: "blocked" })).rejects.toThrow(
    "Kafka publishing is disabled",
  );
});

it("should no-op non-blocking publish when Kafka is disabled", async () => {
  (mockConfig.kafka as { enabled?: boolean }).enabled = false;
  service = new KafkaService(mockConfig, mockLogger, mockMetrics);

  service.publishNonBlocking("custom.topic", { event: "ignored" });
  await Promise.resolve();

  expect(mockProducer.send).not.toHaveBeenCalled();
  expect(mockLogger.debug).toHaveBeenCalledWith(
    expect.stringContaining("Kafka publishing disabled"),
    "KafkaService",
  );
});
```

- [ ] **Step 2: Run Kafka tests and verify failure**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/kafka/kafka.service.spec.ts
```

Expected: fail because disabled mode does not exist.

- [ ] **Step 3: Implement disabled mode**

In `api-center/src/kafka/kafka.service.ts`, add:

```ts
private readonly enabled: boolean;
private disabledPublishLogged = false;
```

Set it in the constructor:

```ts
this.enabled = this.config.kafka.enabled !== false;
this.kafka = this.createKafkaClient();
this.producer = this.kafka.producer();
```

Add a helper:

```ts
private getDisabledError(): Error {
  return new Error("Kafka publishing is disabled");
}
```

Update lifecycle methods:

```ts
async onModuleInit() {
  if (!this.enabled) {
    this.connected = false;
    this.metrics?.setKafkaProducerConnected(false);
    this.logger.log("Kafka producer disabled by configuration", "KafkaService");
    return;
  }
  // existing connect logic
}

async onModuleDestroy() {
  if (!this.enabled) {
    this.connected = false;
    this.metrics?.setKafkaProducerConnected(false);
    return;
  }
  // existing disconnect logic
}
```

At the start of `publish()` and `publishPhysicalTopic()`:

```ts
if (!this.enabled) {
  throw this.getDisabledError();
}
```

At the start of `publishNonBlocking()`:

```ts
if (!this.enabled) {
  if (!this.disabledPublishLogged) {
    this.logger.debug(
      "Kafka publishing disabled; dropping non-blocking event publishes",
      options?.context || "KafkaService",
    );
    this.disabledPublishLogged = true;
  }
  return;
}
```

- [ ] **Step 4: Run Kafka tests**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/kafka/kafka.service.spec.ts
```

Expected: all Kafka tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/kafka/kafka.service.ts src/kafka/kafka.service.spec.ts
git commit -m "feat(api-center): add Kafka disabled mode"
```

---

## Phase 3: Data Pipeline Disabled Behavior

### Task 3: Disable Explicit Data Pipeline Publishing Cleanly

**Files:**
- Create: `api-center/src/data-pipeline/data-pipeline-disabled.error.ts`
- Modify: `api-center/src/data-pipeline/data-pipeline.module.ts`
- Test: `api-center/src/data-pipeline/athena-query-telemetry.service.spec.ts`

- [ ] **Step 1: Write failing telemetry test**

Add this test to `api-center/src/data-pipeline/athena-query-telemetry.service.spec.ts`:

```ts
it("does not publish Athena telemetry when no publisher is configured", async () => {
  const service = new AthenaQueryTelemetryService({});

  await expect(
    service.record({
      environment: "test",
      topic: "test.api-center.pipeline.athena-query-execution",
      queryExecutionId: "query-1",
      queryState: "SUCCEEDED",
      durationMs: 42,
    }),
  ).resolves.toBeUndefined();
});
```

If the current method name is not `record`, use the existing telemetry method in that file and keep the same assertion: no publisher means no throw.

- [ ] **Step 2: Create disabled error helper**

Create `api-center/src/data-pipeline/data-pipeline-disabled.error.ts`:

```ts
export class DataPipelineDisabledError extends Error {
  constructor(operation: string) {
    super(`Data pipeline is disabled: ${operation}`);
    this.name = "DataPipelineDisabledError";
  }
}

export function dataPipelineDisabled(operation: string): never {
  throw new DataPipelineDisabledError(operation);
}
```

- [ ] **Step 3: Update module provider**

In `api-center/src/data-pipeline/data-pipeline.module.ts`, inject `ConfigService` with `KafkaService`:

```ts
import { ConfigService } from "../config/config.service";
import { dataPipelineDisabled } from "./data-pipeline-disabled.error";
```

Change the `ATHENA_QUERY_TELEMETRY_OPTIONS` factory:

```ts
{
  provide: ATHENA_QUERY_TELEMETRY_OPTIONS,
  inject: [KafkaService, ConfigService],
  useFactory: (kafka: KafkaService, config: ConfigService) => {
    if (!config.dataPipeline.enabled) {
      return {};
    }

    return {
      publisher: {
        publish: (
          topic: string,
          payload: Record<string, unknown>,
          key?: string,
        ) => kafka.publishPhysicalTopic(topic, payload, key),
      },
    };
  },
},
```

Use `dataPipelineDisabled("...")` in explicit mutation endpoints that should not silently succeed when disabled, such as manual raw-to-silver runs or publish endpoints.

- [ ] **Step 4: Run data-pipeline tests**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/data-pipeline/athena-query-telemetry.service.spec.ts src/data-pipeline/pipeline-health.service.spec.ts src/data-pipeline/pipeline-governance.service.spec.ts
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/data-pipeline/data-pipeline-disabled.error.ts src/data-pipeline/data-pipeline.module.ts src/data-pipeline/*.spec.ts
git commit -m "feat(api-center): make data pipeline disabled mode explicit"
```

---

## Phase 4: Keep Tribe Authentication First-Class

### Task 4: Document And Test No-Cloud Tribe Secret Auth

**Files:**
- Modify: `api-center/src/registry/tribe-secret-resolver.service.spec.ts`
- Modify: `api-center/docs/developer/README.md`
- Modify: `api-center/.env.example`

- [ ] **Step 1: Confirm existing env-hash test exists**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/registry/tribe-secret-resolver.service.spec.ts
```

Expected: pass. The test suite should already cover `TRIBE_SECRET_<SERVICE_ID>` hash validation.

- [ ] **Step 2: Add explicit no-cloud regression test if missing**

If the test is not already present, add:

```ts
it("validates tribe secrets from environment hashes without GCP Secret Manager", async () => {
  process.env.TRIBE_SECRET_SMOKE_TRIBE =
    "c0f4a8f6f1a5d8b3767a29db7a7d8f6f0bc124f1e0cc8a7766b6a59b8903a49f";
  delete process.env.TRIBE_SECRET_SOURCE;

  await expect(service.validateSecret("smoke-tribe", "plain-secret")).resolves.toBe(true);
});
```

Replace the hash with the actual SHA-256 value used by the existing helper in the spec. Prefer the local `hashSecret("plain-secret")` helper if present.

- [ ] **Step 3: Update `.env.example`**

Add this section near the auth and tribe secret settings:

```env
# Temporary no-Confluent/no-AWS mode
DATA_PIPELINE_ENABLED=false
KAFKA_ENABLED=false

# Core gateway auth still works in this mode.
AUTH_PROVIDER=internal-jwt
JWT_PRIVATE_KEY=replace-with-rsa-private-key
JWT_PUBLIC_KEY=replace-with-rsa-public-key

# Optional no-GCP tribe secret source. Store SHA-256 hashes, never plaintext.
# Format: TRIBE_SECRET_<SERVICE_ID_UPPER_SNAKE>=<sha256-of-plaintext-secret>
# TRIBE_SECRET_LOGISTICS=<sha256hash>
```

- [ ] **Step 4: Update developer README**

Add:

```md
## Core Gateway Without Data Pipeline

APICenter can run without Confluent Cloud, AWS S3, Athena, or raw-data exports.
Set `DATA_PIPELINE_ENABLED=false` and `KAFKA_ENABLED=false`.

This does not disable tribe authentication. Tribe services still request tokens
from `/api/v1/auth/token` with `tribeId` and plaintext `secret`. APICenter
hashes the plaintext, compares it to the configured tribe secret hash, issues an
internal JWT, and then validates that JWT on proxied calls.

For a temporary no-GCP setup, store secret hashes in environment variables:

```env
TRIBE_SECRET_LOGISTICS=<sha256-of-plaintext-secret>
```

Do not store plaintext tribe secrets in committed files.
```

- [ ] **Step 5: Run auth and resolver tests**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/auth/auth.controller.spec.ts src/auth/guards/jwt-auth.guard.spec.ts src/registry/tribe-secret-resolver.service.spec.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```powershell
git add .env.example docs/developer/README.md src/registry/tribe-secret-resolver.service.spec.ts
git commit -m "docs(api-center): document no-cloud tribe auth mode"
```

---

## Phase 5: Management UI Feature Flag

### Task 5: Hide Or Disable Confluent/AWS Operations In Management

**Files:**
- Create: `apicenter-management/src/lib/feature-flags.ts`
- Create: `apicenter-management/src/lib/feature-flags.test.ts`
- Modify: `apicenter-management/src/components/app-shell.tsx`
- Modify: `apicenter-management/src/components/confluent-provisioning-card.tsx`
- Modify: `apicenter-management/src/components/confluent-pipeline-status-panel.tsx`
- Modify: `apicenter-management/src/components/tribe-onboarding-flow.tsx`
- Test: component tests in `apicenter-management/src/components`

- [ ] **Step 1: Add feature flag module and tests**

Create `apicenter-management/src/lib/feature-flags.ts`:

```ts
export const featureFlags = {
  dataPipelineEnabled:
    process.env.NEXT_PUBLIC_DATA_PIPELINE_ENABLED === "true" ||
    process.env.DATA_PIPELINE_ENABLED === "true",
};

export function isDataPipelineEnabled() {
  return featureFlags.dataPipelineEnabled;
}
```

Create `apicenter-management/src/lib/feature-flags.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

describe("feature flags", () => {
  it("defaults data pipeline to disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_PIPELINE_ENABLED", "");
    vi.stubEnv("DATA_PIPELINE_ENABLED", "");
    vi.resetModules();

    const mod = await import("./feature-flags");

    expect(mod.isDataPipelineEnabled()).toBe(false);
  });

  it("enables data pipeline when explicitly requested", async () => {
    vi.stubEnv("NEXT_PUBLIC_DATA_PIPELINE_ENABLED", "true");
    vi.resetModules();

    const mod = await import("./feature-flags");

    expect(mod.isDataPipelineEnabled()).toBe(true);
  });
});
```

- [ ] **Step 2: Gate navigation**

In `apicenter-management/src/components/app-shell.tsx`, import:

```ts
import { isDataPipelineEnabled } from "@/lib/feature-flags";
```

Then filter the Data Pipeline nav item:

```ts
const navItems = [
  // existing items
].filter((item) => item.href !== "/data-pipeline" || isDataPipelineEnabled());
```

If `app-shell.tsx` defines the array inline in JSX, first assign it to `navItems`, then map over `navItems`.

- [ ] **Step 3: Gate Confluent cards**

At the top of `ConfluentProvisioningCard`, add:

```tsx
if (!isDataPipelineEnabled()) {
  return (
    <Alert>
      <AlertTitle>Data pipeline disabled</AlertTitle>
      <AlertDescription>
        Confluent topic and S3 Sink provisioning are disabled for this environment.
      </AlertDescription>
    </Alert>
  );
}
```

Use the same pattern in `ConfluentPipelineStatusPanel`.

- [ ] **Step 4: Gate tribe onboarding steps**

In `tribe-onboarding-flow.tsx`, when the pipeline is disabled:

```ts
const pipelineStepStatus = isDataPipelineEnabled() ? computedStatus : "skipped";
```

Render copy:

```tsx
Data pipeline disabled for this environment; topic and S3 export setup are skipped.
```

Do not block registration, secret provisioning, or token testing on these skipped steps.

- [ ] **Step 5: Run management tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/feature-flags.test.ts src/components/confluent-provisioning-card.test.tsx src/components/confluent-pipeline-status-panel.test.tsx src/components/tribe-onboarding-flow.test.tsx
```

Expected: tests pass with data pipeline disabled by default and enabled when the env flag is true.

- [ ] **Step 6: Commit**

```powershell
git add src/lib/feature-flags.ts src/lib/feature-flags.test.ts src/components/app-shell.tsx src/components/confluent-provisioning-card.tsx src/components/confluent-pipeline-status-panel.tsx src/components/tribe-onboarding-flow.tsx
git commit -m "feat(management): feature flag data pipeline UI"
```

---

## Phase 6: Consumer Documentation And Operator Handoff

### Task 6: Update Tribe-Facing Docs

**Files:**
- Modify: `api-shared-services/docs/consumer-runbook.md`
- Modify: `api-center/docs/developer/tribe-onboarding.md`
- Modify: `api-center/docs/developer/descope-human-auth-reference.md`

- [ ] **Step 1: Update consumer runbook platform handoff table**

Change the Confluent/S3 rows to optional:

```md
| Kafka publish capability | Optional while data pipeline is disabled | Required only when `DATA_PIPELINE_ENABLED=true` |
| S3 export topic | Optional while data pipeline is disabled | Required only when governed raw export is enabled |
```

- [ ] **Step 2: Add disabled-mode note before S3 export section**

Add:

```md
If the platform is running with `DATA_PIPELINE_ENABLED=false`, skip event
publishing and S3 export validation. Authentication, shared-service calls, and
tribe-to-tribe proxying still work through APICenter tokens.
```

- [ ] **Step 3: Update tribe onboarding**

In `api-center/docs/developer/tribe-onboarding.md`, add:

```md
For the temporary no-Confluent/no-AWS mode, onboarding is complete when the
service is registered, the tribe secret hash is configured, `/api/v1/auth/token`
issues a token, and at least one allowed proxy call succeeds. Do not require
Confluent topic creation or S3 sink inclusion until `DATA_PIPELINE_ENABLED=true`.
```

- [ ] **Step 4: Verify docs references**

Run:

```powershell
cd C:\Codes\apic
rg -n "DATA_PIPELINE_ENABLED|KAFKA_ENABLED|no-Confluent|no-AWS|S3 export validation" api-center api-shared-services
```

Expected: references appear in the updated docs and no text claims Confluent/AWS are required for authentication.

- [ ] **Step 5: Commit**

```powershell
git add api-shared-services/docs/consumer-runbook.md api-center/docs/developer/tribe-onboarding.md api-center/docs/developer/descope-human-auth-reference.md
git commit -m "docs: clarify APICenter auth works without data pipeline"
```

---

## Phase 7: Verification Matrix

### Task 7: End-To-End Verification

**Files:**
- No code changes unless verification finds defects.

- [ ] **Step 1: Backend unit tests**

Run:

```powershell
cd C:\Codes\apic\api-center
npm test -- src/config/config.service.spec.ts src/kafka/kafka.service.spec.ts src/auth/auth.controller.spec.ts src/auth/guards/jwt-auth.guard.spec.ts src/registry/tribe-secret-resolver.service.spec.ts
```

Expected: pass.

- [ ] **Step 2: Backend typecheck**

Run:

```powershell
cd C:\Codes\apic\api-center
npm run typecheck
```

Expected: pass.

- [ ] **Step 3: Backend build**

Run:

```powershell
cd C:\Codes\apic\api-center
npm run build
```

Expected: pass.

- [ ] **Step 4: Management tests**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm test -- src/lib/feature-flags.test.ts src/components/confluent-provisioning-card.test.tsx src/components/confluent-pipeline-status-panel.test.tsx src/components/tribe-onboarding-flow.test.tsx
```

Expected: pass.

- [ ] **Step 5: Management build**

Run:

```powershell
cd C:\Codes\apic\apicenter-management
npm run build
```

Expected: pass.

- [ ] **Step 6: Runtime smoke in disabled mode**

Run API Center with:

```env
NODE_ENV=production
AUTH_PROVIDER=internal-jwt
JWT_PRIVATE_KEY=<valid-rsa-private-key>
JWT_PUBLIC_KEY=<valid-rsa-public-key>
DATA_PIPELINE_ENABLED=false
KAFKA_ENABLED=false
TRIBE_SECRET_SMOKE_TRIBE=<sha256-of-plaintext-secret>
```

Smoke sequence:

```powershell
curl -s -X POST http://localhost:3000/api/v1/auth/token `
  -H "Content-Type: application/json" `
  -d "{\"tribeId\":\"smoke-tribe\",\"secret\":\"<plaintext-secret>\"}"
```

Expected:

```json
{
  "success": true,
  "data": {
    "accessToken": "<jwt>",
    "refreshToken": "<jwt-or-null>",
    "expiresIn": 3600,
    "tribeId": "smoke-tribe"
  }
}
```

Then call an allowed proxy route with:

```powershell
curl -s http://localhost:3000/api/v1/shared/<target-service-id>/health `
  -H "Authorization: Bearer <access-token>"
```

Expected: request is authenticated and either reaches the target service or returns a registry/upstream error unrelated to Kafka/Confluent/AWS.

- [ ] **Step 7: Runtime smoke in enabled mode**

Set:

```env
DATA_PIPELINE_ENABLED=true
KAFKA_ENABLED=true
KAFKA_BROKERS=<confluent-bootstrap-server>:9092
KAFKA_SSL_ENABLED=true
KAFKA_SASL_MECHANISM=plain
KAFKA_SASL_USERNAME=<confluent-api-key>
KAFKA_SASL_PASSWORD=<confluent-api-secret>
```

Expected:

- Startup requires valid Confluent config.
- Token issuance still works.
- Nonblocking auth/registry/audit events publish to Confluent.
- Data-pipeline UI and routes are available.

- [ ] **Step 8: Commit verification fixes**

If verification required fixes:

```powershell
git add <changed-files>
git commit -m "fix: complete data pipeline feature flag verification"
```

---

## Rollout Plan

### Phase A: Local/Development

- Set `DATA_PIPELINE_ENABLED=false`.
- Set `KAFKA_ENABLED=false`.
- Use `AUTH_PROVIDER=dev-jwt` locally or `AUTH_PROVIDER=internal-jwt` with stable keys.
- Use env-hash tribe secrets for test tribes.
- Verify token issuance and one proxy call.

### Phase B: Test Deployment

- Set `AUTH_PROVIDER=internal-jwt`.
- Set `DATA_PIPELINE_ENABLED=false`.
- Set `KAFKA_ENABLED=false`.
- Configure tribe secret hashes through env or Secret Manager.
- Disable management UI data-pipeline actions.
- Promote only auth, registry, shared-service proxy, quota, and onboarding checks.

### Phase C: Re-enable Confluent/AWS Later

- Set `DATA_PIPELINE_ENABLED=true`.
- Set `KAFKA_ENABLED=true`.
- Add Confluent producer credentials.
- Confirm Confluent topic creation and S3 sink inclusion.
- Re-enable management Data Pipeline nav and provisioning cards.
- Run data-pipeline smoke: SDK publish -> APICenter accepted -> Confluent topic observed -> S3 object observed.

---

## Acceptance Criteria

- APICenter starts in production with `DATA_PIPELINE_ENABLED=false` and no Kafka/Confluent/AWS credentials.
- `/api/v1/auth/token` still issues internal JWTs.
- Bearer token validation still protects proxy routes.
- Registry access, scope checks, quotas, lifecycle gates, and circuit breakers still run.
- Nonblocking audit/event publishing does not spam failures when Kafka is disabled.
- Explicit publish/data-pipeline endpoints return a clear disabled response or are hidden by management UI.
- Management onboarding still supports registration, secret provisioning, and token smoke tests.
- Consumer docs clearly state that Confluent/AWS are optional for now and unrelated to basic APICenter authentication.

## Self-Review

- Spec coverage: The plan covers removing Confluent/AWS as runtime requirements, preserving APICenter auth, adding feature flags, disabling backend and management pipeline surfaces, and documenting the temporary operating model.
- Placeholder scan: No implementation step requires unspecified "appropriate handling"; each task names concrete files, flags, tests, commands, and expected behavior.
- Type consistency: The planned flags are `DATA_PIPELINE_ENABLED`, `KAFKA_ENABLED`, `config.dataPipeline.enabled`, `config.kafka.enabled`, `NEXT_PUBLIC_DATA_PIPELINE_ENABLED`, and `isDataPipelineEnabled()`.
