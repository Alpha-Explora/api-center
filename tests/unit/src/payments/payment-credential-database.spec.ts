import { Test, type TestingModule } from "@nestjs/testing";
import { PrismaService } from "@database/prisma.service";
import { TENANCY_DIRECTORY } from "@registry/tenancy.types";
import { PaymentConsumerManagementService } from "../../../../apps/gateway/src/domains/payments/features/consumer-management/payment-consumer-management.service";
import { PaymentApiKeyService } from "../../../../apps/gateway/src/domains/payments/features/payment-facade/payment-api-key.service";
import { randomUUID } from "node:crypto";
import { VerificationEvidenceService } from "@operations/verification-evidence.service";
import { RuntimeDeploymentObserver } from "@operations/runtime-deployment-observer.service";
import { PAYMENT_CREDENTIAL_EVIDENCE_DIRECTORY } from "../../../../apps/gateway/src/domains/payments/features/consumer-management/payment-consumer.types";
import { createHash } from "node:crypto";
import { RegistryService } from "@registry/registry.service";
import { LoggerService } from "@shared/logger.service";
import {
  ServiceSecretResolverService,
  SERVICE_SECRET_MANAGER_CLIENT,
} from "../../../../apps/gateway/src/domains/catalog-registry/registry/service-secret-resolver.service";
import {
  ServiceCredentialLifecycleService,
  SERVICE_CREDENTIAL_MANAGER,
} from "../../../../apps/gateway/src/domains/catalog-registry/registry/service-credential-lifecycle.service";

const url = process.env.APICENTER_OPERABILITY_TEST_URL;
const suite = url ? describe : describe.skip;
suite("payment credential persistence against disposable PostgreSQL", () => {
  let database: PrismaService;
  let module: TestingModule;
  let consumers: PaymentConsumerManagementService;
  let keys: PaymentApiKeyService;
  const organization = randomUUID();
  const suffix = randomUUID().slice(0, 8);
  const tribeId = `credential-${suffix}`;
  const projectId = `credential-project-${suffix}`;
  const serviceId = `credential-api-${suffix}`;
  const previous = {
    url: process.env.DATABASE_URL,
    enabled: process.env.DATABASE_ENABLED,
  };
  const secretEnvironment = {
    source: process.env.TRIBE_SECRET_SOURCE,
    project: process.env.GCP_PROJECT_ID,
  };
  const original = "original-test-secret";
  const replacement = "replacement-test-secret";
  let secretVersion = 1;
  let secretPayload = {
    serviceId,
    environment: "test",
    status: "active",
    rotationState: "active_current",
    secretHashSha256: createHash("sha256").update(original).digest("hex"),
  };
  const manager = {
    accessSecretVersion: jest.fn(async () => [
      {
        name: `projects/test-project/secrets/service-secret/versions/${secretVersion}`,
        payload: { data: Buffer.from(JSON.stringify(secretPayload)) },
      },
    ]),
    addSecretVersion: jest.fn(async (input: { payload: { data: Buffer } }) => {
      secretPayload = JSON.parse(input.payload.data.toString("utf8"));
      secretVersion++;
      return [
        {
          name: `projects/test-project/secrets/service-secret/versions/${secretVersion}`,
        },
      ];
    }),
  };
  beforeAll(async () => {
    if (!url) throw new Error("Dedicated test database required");
    const target = new URL(url);
    if (
      !["127.0.0.1", "localhost"].includes(target.hostname) ||
      target.pathname !== "/apicenter_test"
    )
      throw new Error("Refusing nondedicated test database");
    process.env.DATABASE_URL = url;
    process.env.DATABASE_ENABLED = "true";
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    process.env.GCP_PROJECT_ID = "test-project";
    database = new PrismaService();
    await database.$connect();
    await database.$executeRawUnsafe(
      "INSERT INTO apic_catalog.organizations(id,slug,name) VALUES ($1::uuid,$2,'Credential test')",
      organization,
      `credentials-${suffix}`,
    );
    await database.$executeRawUnsafe(
      "INSERT INTO apic_catalog.tribes(tribe_id,organization_id,name) VALUES ($1,$2::uuid,'Credential test')",
      tribeId,
      organization,
    );
    await database.$executeRawUnsafe(
      "INSERT INTO apic_catalog.projects(project_id,tribe_id,name) VALUES ($1,$2,'Credential test')",
      projectId,
      tribeId,
    );
    await database.$executeRawUnsafe(
      "INSERT INTO apic_catalog.services(organization_id,service_id,name,service_type,base_url,owner_tribe_id,project_id) VALUES ($1::uuid,$2,'Credential test','tribe','https://consumer.example.test',$3,$4)",
      organization,
      serviceId,
      tribeId,
      projectId,
    );
    module = await Test.createTestingModule({
      providers: [
        PaymentConsumerManagementService,
        PaymentApiKeyService,
        ServiceCredentialLifecycleService,
        ServiceSecretResolverService,
        VerificationEvidenceService,
        { provide: PrismaService, useValue: database },
        { provide: SERVICE_CREDENTIAL_MANAGER, useValue: manager },
        { provide: SERVICE_SECRET_MANAGER_CLIENT, useValue: manager },
        {
          provide: RegistryService,
          useValue: {
            get: () => ({
              serviceId,
              projectId,
              ownerTribeId: tribeId,
              consumes: [],
              exposes: [],
              requiredScopes: [],
              environments: [
                {
                  environment: "test",
                  baseUrl: "https://consumer.example.test",
                },
              ],
            }),
            credentialMetadata: async () => null,
            resolveStorageId: async () =>
              (
                await database.$queryRawUnsafe<Array<{ id: string }>>(
                  "SELECT id FROM apic_catalog.services WHERE service_id=$1 AND project_id=$2",
                  serviceId,
                  projectId,
                )
              )[0].id,
          },
        },
        {
          provide: PAYMENT_CREDENTIAL_EVIDENCE_DIRECTORY,
          useValue: { credentialVersions: async () => [] },
        },
        {
          provide: RuntimeDeploymentObserver,
          useValue: {
            observe: async () => ({
              complete: true,
              deployments: [
                {
                  serviceId,
                  revision: "consumer-00001",
                  imageDigest: "sha256:" + "a".repeat(64),
                },
              ],
            }),
          },
        },
        {
          provide: LoggerService,
          useValue: {
            warn: jest.fn(),
            info: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
          },
        },
        {
          provide: TENANCY_DIRECTORY,
          useValue: {
            resolveServicePlacement: (id: string) =>
              id === serviceId ? { serviceId, projectId, tribeId } : null,
            listTribes: () => [{ tribeId, organizationId: organization }],
          },
        },
      ],
    }).compile();
    consumers = module.get(PaymentConsumerManagementService);
    keys = module.get(PaymentApiKeyService);
  });
  afterAll(async () => {
    if (database) {
      await database.$executeRawUnsafe(
        "DELETE FROM apic_runtime.verification_reports WHERE service_id=$1",
        serviceId,
      );
      await database.$executeRawUnsafe(
        "DELETE FROM apic_runtime.verification_runs WHERE service_id=$1",
        serviceId,
      );
      await database.$executeRawUnsafe(
        "DELETE FROM apic_catalog.service_credential_usage WHERE service_id=$1",
        serviceId,
      );
      await database.$executeRawUnsafe(
        "DELETE FROM apic_catalog.service_credential_operations WHERE service_id=$1",
        serviceId,
      );
      await database.$executeRawUnsafe(
        "DELETE FROM apic_governance.payment_credential_operations WHERE consumer_service_id=$1",
        serviceId,
      );
      await database.$executeRawUnsafe(
        "DELETE FROM apic_governance.payment_consumer_services WHERE consumer_service_id=$1",
        serviceId,
      );
      await database.$executeRawUnsafe(
        "DELETE FROM apic_catalog.services WHERE service_id=$1 AND project_id=$2",
        serviceId,
        projectId,
      );
      await database.$executeRawUnsafe(
        "DELETE FROM apic_catalog.projects WHERE project_id=$1",
        projectId,
      );
      await database.$executeRawUnsafe(
        "DELETE FROM apic_catalog.tribes WHERE tribe_id=$1",
        tribeId,
      );
      await database.$executeRawUnsafe(
        "DELETE FROM apic_catalog.organizations WHERE id=$1::uuid",
        organization,
      );
      await database.$disconnect();
    }
    if (module) await module.close();
    if (previous.url === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous.url;
    if (previous.enabled === undefined) delete process.env.DATABASE_ENABLED;
    else process.env.DATABASE_ENABLED = previous.enabled;
    if (secretEnvironment.source === undefined)
      delete process.env.TRIBE_SECRET_SOURCE;
    else process.env.TRIBE_SECRET_SOURCE = secretEnvironment.source;
    if (secretEnvironment.project === undefined)
      delete process.env.GCP_PROJECT_ID;
    else process.env.GCP_PROJECT_ID = secretEnvironment.project;
  });
  it("commits issuance receipts and refuses to reveal or replace a key on retry", async () => {
    const input = {
      consumerServiceId: serviceId,
      environment: "test",
      operationId: randomUUID(),
      scopes: ["payments:read"],
    };
    const result = await consumers.register(input);
    await expect(consumers.register(input)).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ code: "CREDENTIAL_ALREADY_ISSUED" }),
    });
    await expect(
      consumers.register({ ...input, scopes: ["payments:write"] }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        code: "CREDENTIAL_OPERATION_MISMATCH",
      }),
    });
    expect(await keys.resolve(result.apiKey)).toMatchObject({
      consumerServiceId: serviceId,
      environment: "test",
    });
    const rows = await database.$queryRawUnsafe<Array<{ count: bigint }>>(
      "SELECT count(*) FROM apic_governance.payment_credential_operations WHERE consumer_service_id=$1",
      serviceId,
    );
    expect(Number(rows[0].count)).toBe(1);
  });
  it("serializes concurrent rotations, preserves overlap, and targets revocation", async () => {
    const input = {
      consumerServiceId: serviceId,
      environment: "test",
      scopes: ["payments:read"],
    };
    const replacements = await Promise.all([
      consumers.rotate({ ...input, operationId: randomUUID() }),
      consumers.rotate({ ...input, operationId: randomUUID() }),
    ]);
    const principals = await Promise.all(
      replacements.map((result) => keys.resolve(result.apiKey)),
    );
    expect(principals.every(Boolean)).toBe(true);
    const rows = await database.$queryRawUnsafe<
      Array<{ id: string; expires_at: Date; last_used_at: Date | null }>
    >(
      "SELECT k.id,k.expires_at,k.last_used_at FROM apic_governance.payment_api_keys k JOIN apic_governance.payment_consumer_services s ON s.id=k.consumer_service_id WHERE s.consumer_service_id=$1 ORDER BY k.expires_at",
      serviceId,
    );
    expect(
      rows.filter((row) => row.expires_at.getTime() > Date.now() + 86_400_000)
        .length,
    ).toBe(1);
    const older = principals.find(
      (principal) => principal?.keyId !== rows[rows.length - 1].id,
    );
    if (!older?.keyId) throw new Error("Expected a previous key");
    await consumers.revoke({ ...input, keyId: older.keyId });
    const newest = replacements.find(
      (_, index) => principals[index]?.keyId === rows[rows.length - 1].id,
    );
    if (!newest) throw new Error("Expected replacement key");
    expect(await keys.resolve(newest.apiKey)).not.toBeNull();
    const old = replacements.find(
      (_, index) => principals[index]?.keyId === older.keyId,
    );
    if (!old) throw new Error("Expected older key");
    expect(await keys.resolve(old.apiKey)).toBeNull();
    expect(rows.some((row) => row.last_used_at !== null)).toBe(true);
  });
  it("requires real replacement authentication before persisting old-secret revocation", async () => {
    const lifecycle = module.get(ServiceCredentialLifecycleService);
    const resolver = module.get(ServiceSecretResolverService);
    const action = {
      serviceId,
      environment: "test",
      actor: "test-operator",
      reason: "Controlled credential rotation",
    };
    const started = await lifecycle.apply({
      ...action,
      operationId: randomUUID(),
      action: "start",
      secretHashSha256: createHash("sha256").update(replacement).digest("hex"),
    });
    expect(started.rotationState).toBe("active_dual_valid");
    await expect(
      lifecycle.apply({
        ...action,
        operationId: randomUUID(),
        action: "verify",
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await resolver.validateEnvironmentSecret(serviceId, original, "test"),
    ).toBe(true);
    expect(
      await resolver.validateEnvironmentSecret(serviceId, replacement, "test"),
    ).toBe(true);
    expect(
      (
        await lifecycle.apply({
          ...action,
          operationId: randomUUID(),
          action: "verify",
        })
      ).rotationState,
    ).toBe("old_pending_revoke");
    expect(
      (
        await lifecycle.apply({
          ...action,
          operationId: randomUUID(),
          action: "revoke-old",
        })
      ).rotationState,
    ).toBe("old_revoked");
    expect(
      await resolver.validateEnvironmentSecret(serviceId, original, "test"),
    ).toBe(false);
    expect(
      await resolver.validateEnvironmentSecret(serviceId, replacement, "test"),
    ).toBe(true);
    expect(
      JSON.stringify(await resolver.credentialMetadata(serviceId, "test")),
    ).not.toMatch(/secretHash|plaintext|replacement-test-secret/);
  });

  it("persists immutable evidence and requires reconciliation before another uncertain run", async () => {
    const original = {
      sha: process.env.APICENTER_RELEASE_SHA,
      runners: process.env.APICENTER_VERIFICATION_RUNNERS,
    };
    process.env.APICENTER_RELEASE_SHA = "a".repeat(40);
    process.env.APICENTER_VERIFICATION_RUNNERS = JSON.stringify([
      {
        subject: "test-runner",
        serviceIds: [serviceId],
        environments: ["test"],
      },
    ]);
    const evidence = module.get(VerificationEvidenceService);
    const target = { serviceId, environment: "test" as const };
    const runner = {
      subject: "test-runner",
      environment: "test",
      scopes: ["verification:write"],
    };
    try {
      const queued = await evidence.requestRun(target, "test-operator");
      const claimed = await evidence.claim(
        { ...target, runId: queued.runId },
        runner,
      );
      const report = {
        version: 1,
        ...target,
        runId: claimed.runId,
        configurationFingerprint: claimed.configurationFingerprint,
        gatewayRevision: claimed.gatewayRevision,
        deploymentRevision: "consumer-00001",
        ciRunId: "local/1",
        observedAt: new Date().toISOString(),
        checks: ["health", "authentication", "authorization", "discovery"].map(
          (checkId) => ({ checkId, status: "passed" }),
        ),
      };
      expect((await evidence.record(report, runner)).ready).toBe(true);
      expect((await evidence.record(report, runner)).ready).toBe(true);
      expect((await evidence.latest(serviceId, "test")).ready).toBe(true);
      await expect(
        evidence.record({ ...report, ciRunId: "changed" }, runner),
      ).rejects.toMatchObject({ status: 400 });
      const next = await evidence.requestRun(target, "test-operator");
      await evidence.claim({ ...target, runId: next.runId }, runner);
      expect(
        (
          await evidence.record(
            {
              ...report,
              runId: next.runId,
              checks: [
                ...report.checks,
                {
                  checkId: "provider.email",
                  status: "blocked",
                  errorCode: "PROVIDER_OUTCOME_UNKNOWN",
                },
              ],
            },
            runner,
          )
        ).ready,
      ).toBe(false);
      await expect(
        evidence.requestRun(target, "test-operator"),
      ).rejects.toMatchObject({ status: 409 });
      expect((await evidence.latest(serviceId, "test")).ready).toBe(false);
      await evidence.reconcile(
        {
          ...target,
          runId: next.runId,
          reason: "Provider dashboard confirms the original operation result",
        },
        "test-operator",
      );
      expect((await evidence.latest(serviceId, "test")).ready).toBe(false);
      expect((await evidence.requestRun(target, "test-operator")).status).toBe(
        "queued",
      );
    } finally {
      if (original.sha === undefined) delete process.env.APICENTER_RELEASE_SHA;
      else process.env.APICENTER_RELEASE_SHA = original.sha;
      if (original.runners === undefined)
        delete process.env.APICENTER_VERIFICATION_RUNNERS;
      else process.env.APICENTER_VERIFICATION_RUNNERS = original.runners;
    }
  });
});
