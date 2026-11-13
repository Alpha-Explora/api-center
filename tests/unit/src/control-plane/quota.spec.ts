import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ApplicationAccessService } from "../../../../apps/gateway/src/domains/control-plane/application-access.service";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { QuotaService } from "../../../../apps/gateway/src/domains/control-plane/quota.service";
import { composeBudgets, windowStart } from "../../../../apps/gateway/src/domains/control-plane/quota-budgets";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000d1";
const actor = "admin@example.test";
const testEnv = { id: "env_t", kind: "test" as const };
const liveEnv = { id: "env_l", kind: "live" as const };

describe("composeBudgets", () => {
  const base = { capability: "email", policies: [], testDailyRequests: 1000 };

  it("gives a test environment without a plan a bounded default", () => {
    expect(composeBudgets({ ...base, environment: testEnv, planKey: undefined })).toEqual({
      ok: true,
      budgets: [{ key: "test-default:env_t", limit: 1000, windowSeconds: 86400, mode: "enforce", source: "test-default" }],
    });
  });

  it("blocks live traffic without a plan, and test-only plans in live", () => {
    expect(composeBudgets({ ...base, environment: liveEnv, planKey: undefined })).toEqual({ ok: false, code: "LIVE_PLAN_REQUIRED" });
    expect(composeBudgets({ ...base, environment: liveEnv, planKey: "starter" })).toEqual({ ok: false, code: "PLAN_NOT_AVAILABLE" });
    expect(composeBudgets({ ...base, environment: liveEnv, planKey: "standard" })).toMatchObject({ ok: true });
  });

  it("applies the plan, matching project policies and shared ceilings together", () => {
    const result = composeBudgets({
      ...base,
      environment: liveEnv,
      planKey: "standard",
      policies: [
        { id: "qp_email", scope: "project", capability: "email", windowSeconds: 60, maxRequests: 10, mode: "enforce" },
        { id: "qp_sms", scope: "project", capability: "sms", windowSeconds: 60, maxRequests: 10, mode: "enforce" },
        { id: "qp_shared", scope: "shared", capability: null, windowSeconds: 3600, maxRequests: 500, mode: "observe" },
      ],
    });
    expect(result.ok && result.budgets.map((budget) => [budget.key, budget.source, budget.mode])).toEqual([
      ["plan:env_l", "plan", "enforce"],
      ["policy:qp_email", "project-policy", "enforce"],
      ["policy:qp_shared", "shared-ceiling", "observe"],
    ]);
  });

  it("aligns windows to the epoch", () => {
    expect(windowStart(new Date("2026-11-14T10:17:30Z"), 3600).toISOString()).toBe("2026-11-14T10:00:00.000Z");
  });
});

describe("request budgets on the application path", () => {
  let prisma: FakeControlPlanePrisma;
  let admin: ControlPlaneAdminService;
  let quotas: QuotaService;
  let access: ApplicationAccessService;
  const { privateKey } = generateKeyPairSync("ed25519");

  beforeEach(() => {
    process.env.DATABASE_ENABLED = "true";
    process.env.CONTROL_PLANE_TEST_DAILY_REQUESTS = "2";
    prisma = createFakeControlPlanePrisma();
    prisma.organization.rows.push({ id: ORG, status: "active" });
    const db = prisma as unknown as PrismaService;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
    admin = new ControlPlaneAdminService(db, audit);
    quotas = new QuotaService(db, audit);
    access = new ApplicationAccessService(
      db,
      new RuntimeContextSigner({ APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k" }) }),
      quotas,
    );
  });

  afterEach(() => {
    delete process.env.CONTROL_PLANE_TEST_DAILY_REQUESTS;
  });

  async function setup() {
    const project = await admin.createProject(ORG, { slug: "shop", name: "Shop" }, actor);
    const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
    await admin.setCapability(scope, "email", true, actor);
    const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
    await admin.grant(scope, app.id, { capability: "email", action: "email:send" }, actor);
    const { secret } = await admin.issueCredential(scope, app.id, { operationId: randomUUID() }, actor);
    const send = (idempotencyKey?: string) =>
      access.authorize({ bearer: secret, capability: "email", method: "POST", relativePath: "/send", requestId: randomUUID(), idempotencyKey });
    return { project, scope, app, send };
  }

  it("rejects requests beyond the test default with a retry hint", async () => {
    const { send } = await setup();
    await send();
    await send();
    await expect(send()).rejects.toMatchObject({ status: 429, code: "QUOTA_EXCEEDED", retryAfterSeconds: expect.any(Number) });
  });

  it("counts retries of one idempotent operation once", async () => {
    const { send } = await setup();
    await send("same-operation-key-0001");
    await send("same-operation-key-0001");
    await send("same-operation-key-0001");
    await expect(send()).resolves.toBeDefined();
    expect(prisma.cpUsageRecord.rows).toHaveLength(2);
  });

  it("lets an assigned plan replace the test default", async () => {
    const { scope, send } = await setup();
    await quotas.assignPlan(scope, "standard", actor);
    for (let i = 0; i < 5; i += 1) await send();
  });

  it("enforces a shared ceiling only on the projects it covers", async () => {
    const covered = await setup();
    const other = await admin.createProject(ORG, { slug: "other", name: "Other" }, actor);
    await quotas.assignPlan(covered.scope, "standard", actor);
    await quotas.createSharedPolicy(ORG, [covered.project.id], { environmentKind: "test", windowSeconds: 60, maxRequests: 1, mode: "enforce" }, actor);
    await covered.send();
    await expect(covered.send()).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    const otherPolicies = await quotas.listPolicies(ORG, other.id);
    expect(otherPolicies).toEqual([]);
  });

  it("refuses a test-only plan for a live environment", async () => {
    const { project } = await setup();
    await expect(
      quotas.assignPlan({ organizationId: ORG, projectId: project.id, environmentKind: "live" }, "starter", actor),
    ).rejects.toMatchObject({ code: "PLAN_NOT_AVAILABLE" });
  });

  it("records request outcomes for usage reporting", async () => {
    const { scope, send } = await setup();
    const call = await send();
    await access.recordOutcome(call, 201);
    const summary = await quotas.usageSummary(scope, new Date(Date.now() - 60_000));
    expect(summary.byApplicationAction).toEqual([expect.objectContaining({ action: "email:send", completed: 1 })]);
  });
});
