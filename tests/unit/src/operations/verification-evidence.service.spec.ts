import { Test } from "@nestjs/testing";
import { PrismaService } from "@database/prisma.service";
import { RegistryService } from "@registry/registry.service";
import { PAYMENT_CREDENTIAL_EVIDENCE_DIRECTORY } from "../../../../apps/gateway/src/domains/payments/features/consumer-management/payment-consumer.types";
import { VerificationEvidenceService } from "@operations/verification-evidence.service";
import { RuntimeDeploymentObserver } from "@operations/runtime-deployment-observer.service";
import {
  VerificationReport,
  configurationFingerprint,
  summarizeVerification,
} from "@operations/verification-evidence.schema";
import type { ServiceRegistryEntry } from "../../../../apps/gateway/src/types";

const entry: ServiceRegistryEntry = {
  serviceId: "billing-api",
  name: "Billing",
  serviceType: "tribe",
  projectId: "billing",
  ownerTribeId: "alpha",
  baseUrl: "https://test.example.test",
  requiredScopes: ["payments:read"],
  exposes: [],
  consumes: ["payments"],
  registeredAt: "2026-11-13T00:00:00Z",
  updatedAt: "2026-11-13T00:00:00Z",
  status: "active",
  environments: [{ environment: "live", baseUrl: "https://live.example.test" }],
};
const revision = "a".repeat(40);
const now = Date.parse("2026-11-13T00:00:00Z");
function report() {
  return VerificationReport.parse({
    version: 1,
    runId: "00000000-0000-4000-8000-000000000001",
    serviceId: entry.serviceId,
    environment: "live",
    configurationFingerprint: configurationFingerprint(entry, "live"),
    gatewayRevision: revision,
    deploymentRevision: "billing-api-00001",
    ciRunId: "github/42",
    observedAt: new Date(now).toISOString(),
    checks: [
      "health",
      "authentication",
      "authorization",
      "discovery",
      "provider.payments",
    ].map((checkId) => ({ checkId, status: "passed" })),
  });
}
describe("verification evidence", () => {
  it("requires all enabled provider checks and never infers success from registry health", () => {
    const input = {
      entry,
      environment: "live" as const,
      fingerprint: configurationFingerprint(entry, "live"),
      gatewayRevision: revision,
      now,
    };
    expect(summarizeVerification({ ...input, report: null })).toMatchObject({
      ready: false,
      checks: expect.arrayContaining([
        { checkId: "health", status: "missing" },
      ]),
    });
    expect(summarizeVerification({ ...input, report: report() }).ready).toBe(
      true,
    );
    expect(
      summarizeVerification({
        ...input,
        report: {
          ...report(),
          checks: report().checks.filter(
            (check) => check.checkId !== "provider.payments",
          ),
        },
      }).ready,
    ).toBe(false);
  });

  it("expires results at exactly 24 hours and after a revision or configuration change", () => {
    const input = {
      entry,
      environment: "live" as const,
      fingerprint: configurationFingerprint(entry, "live"),
      gatewayRevision: revision,
      report: report(),
      now,
    };
    for (const change of [
      { now: now + 86_400_000 },
      { gatewayRevision: "b".repeat(40) },
      { fingerprint: "c".repeat(64) },
    ]) {
      expect(summarizeVerification({ ...input, ...change })).toMatchObject({
        ready: false,
        checks: expect.arrayContaining([
          { checkId: "health", status: "stale" },
        ]),
      });
    }
    expect(
      summarizeVerification({ ...input, gatewayRevision: null }).ready,
    ).toBe(false);
    expect(
      summarizeVerification({ ...input, deploymentKnown: false }).ready,
    ).toBe(false);
    expect(
      summarizeVerification({
        ...input,
        deploymentKnown: true,
        deploymentRevision: "billing-api-00002",
      }).ready,
    ).toBe(false);
    expect(
      summarizeVerification({ ...input, eventDeliveryRequired: true }).checks,
    ).toContainEqual({ checkId: "event_delivery", status: "missing" });
  });

  it("rejects unbounded payloads, extra secret fields and duplicate check IDs", () => {
    expect(
      VerificationReport.safeParse({ ...report(), secret: "never-store" })
        .success,
    ).toBe(false);
    expect(
      VerificationReport.safeParse({
        ...report(),
        checks: [...report().checks, report().checks[0]],
      }).success,
    ).toBe(false);
    expect(
      VerificationReport.safeParse({
        ...report(),
        checks: [
          { checkId: "authentication", status: "passed", body: "sensitive" },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires a scoped runner assignment before reading or writing any report", async () => {
    const database = { $queryRawUnsafe: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        VerificationEvidenceService,
        { provide: PrismaService, useValue: database },
        { provide: RegistryService, useValue: { get: () => entry } },
        {
          provide: PAYMENT_CREDENTIAL_EVIDENCE_DIRECTORY,
          useValue: { credentialVersions: () => [] },
        },
        {
          provide: RuntimeDeploymentObserver,
          useValue: { observe: () => ({ complete: false, deployments: [] }) },
        },
      ],
    }).compile();
    const service = module.get(VerificationEvidenceService);
    const previous = process.env.APICENTER_VERIFICATION_RUNNERS;
    process.env.APICENTER_VERIFICATION_RUNNERS = JSON.stringify([
      { subject: "runner", serviceIds: ["other-api"], environments: ["live"] },
    ]);
    try {
      await expect(
        service.record(report(), {
          subject: "runner",
          environment: "live",
          scopes: ["verification:write"],
        }),
      ).rejects.toMatchObject({ status: 403 });
      expect(database.$queryRawUnsafe).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined)
        delete process.env.APICENTER_VERIFICATION_RUNNERS;
      else process.env.APICENTER_VERIFICATION_RUNNERS = previous;
      await module.close();
    }
  });
});
