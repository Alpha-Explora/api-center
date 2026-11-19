import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ApplicationAccessService } from "../../../../apps/gateway/src/domains/control-plane/application-access.service";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { QuotaService } from "../../../../apps/gateway/src/domains/control-plane/quota.service";
import { ConsoleAccessService } from "../../../../apps/gateway/src/domains/control-plane/console-access.service";
import type { ConsoleRequest } from "../../../../apps/gateway/src/domains/control-plane/console-actor.guard";
import { auditScope, canPerform, type ConsoleActor, type MemberAccess } from "../../../../apps/gateway/src/domains/control-plane/console-access.policy";
import { ObservabilityService } from "../../../../apps/gateway/src/domains/control-plane/observability/observability.service";
import { ObservabilityController } from "../../../../apps/gateway/src/domains/control-plane/observability/observability.controller";
import { decodeCursor, encodeCursor, pageOf } from "../../../../apps/gateway/src/domains/control-plane/observability/cursor";
import { requestLogQuery, requestLogWindow, statusRange, toRequestLogEntry } from "../../../../apps/gateway/src/domains/control-plane/observability/request-log";
import { buildUsageSeries, usageWindow } from "../../../../apps/gateway/src/domains/control-plane/observability/usage-series";
import { buildQuotaMeters } from "../../../../apps/gateway/src/domains/control-plane/observability/quota-meters";
import { auditLogWhere, redactAuditDetails, toAuditLogEntry } from "../../../../apps/gateway/src/domains/control-plane/observability/audit-log";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000e1";
const NOW = new Date("2026-11-20T10:17:30Z");
const member = (email: string): ConsoleActor => ({ kind: "member", email, subject: `sub-${email}`, platformAdmin: false });

describe("cursors", () => {
  it("round-trips the last row's time and ID", () => {
    const cursor = { at: new Date("2026-11-20T10:00:00.123Z"), id: "5b0c6e9e-4b1f-4f7e-9a51-0c1d2e3f4a5b" };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it("rejects a tampered cursor", () => {
    expect(() => decodeCursor("not-a-cursor")).toThrow("cursor is invalid");
    expect(() => decodeCursor(Buffer.from(JSON.stringify(["2026-11-20T10:00:00Z", "x' OR 1=1"])).toString("base64url"))).toThrow();
  });

  it("returns a next cursor only when another page exists", () => {
    const rows = [1, 2, 3].map((n) => ({ at: new Date(n * 1000), id: `r${n}` }));
    expect(pageOf(rows, 3, (row) => row)).toEqual({ items: rows, nextCursor: null });
    const page = pageOf(rows, 2, (row) => row);
    expect(page.items).toHaveLength(2);
    expect(decodeCursor(page.nextCursor!)).toEqual({ at: new Date(2000), id: "r2" });
  });
});

describe("request log", () => {
  it("maps status classes to ranges", () => {
    expect(statusRange(undefined)).toEqual([100, 599]);
    expect(statusRange("4xx")).toEqual([400, 499]);
  });

  it("reads the last 24 hours by default and never past retention", () => {
    expect(requestLogWindow({}, NOW)).toEqual({ from: new Date("2026-11-19T10:17:30Z"), to: NOW });
    expect(requestLogWindow({ from: "2026-01-01T00:00:00Z" }, NOW).from).toEqual(new Date("2026-10-21T10:17:30Z"));
    expect(() => requestLogWindow({ from: "2026-11-20T10:00:00Z", to: "2026-11-20T09:00:00Z" }, NOW)).toThrow("from must be before to");
  });

  it("refuses unknown filters", () => {
    expect(requestLogQuery.safeParse({ path: "/x" }).success).toBe(false);
    expect(requestLogQuery.safeParse({ applicationId: "app_x" }).success).toBe(false);
    expect(requestLogQuery.parse({ status: "5xx", limit: "10" })).toEqual({ status: "5xx", limit: 10 });
  });

  it("returns only the reported fields", () => {
    const row = {
      requestId: "r1",
      occurredAt: NOW,
      applicationId: "app_1",
      method: "POST",
      route: "/api/v1/email/send",
      statusCode: 502,
      durationMs: 120,
      failureStage: "provider",
      errorCode: "PROVIDER_UNAVAILABLE",
      correlationId: "c1",
      paymentResourceId: "pay_1",
    };
    expect(Object.keys(toRequestLogEntry(row))).not.toContain("paymentResourceId");
    expect(toRequestLogEntry(row).occurredAt).toBe(NOW.toISOString());
  });
});

describe("usage series", () => {
  it("uses 24 hourly buckets or UTC days ending now", () => {
    const hourly = usageWindow("24h", NOW);
    expect(hourly.bucket).toBe("hour");
    expect(hourly.starts).toHaveLength(24);
    expect(hourly.starts[23].toISOString()).toBe("2026-11-20T10:00:00.000Z");
    expect(hourly.starts[0].toISOString()).toBe("2026-11-19T11:00:00.000Z");
    const daily = usageWindow("30d", NOW);
    expect(daily.starts).toHaveLength(30);
    expect(daily.starts[29].toISOString()).toBe("2026-11-20T00:00:00.000Z");
  });

  it("totals buckets, applications and actions, and ignores rows outside the window", () => {
    const at = (iso: string) => new Date(iso);
    const series = buildUsageSeries("7d", NOW, [
      { bucketStart: at("2026-11-20T00:00:00Z"), applicationId: "app_a", capability: "email", action: "email:send", outcome: "completed", requests: 5 },
      { bucketStart: at("2026-11-20T00:00:00Z"), applicationId: "app_a", capability: "email", action: "email:send", outcome: "failed", requests: 1 },
      { bucketStart: at("2026-11-18T00:00:00Z"), applicationId: "app_b", capability: "sms", action: "sms:send", outcome: "admitted", requests: 2 },
      { bucketStart: at("2026-11-01T00:00:00Z"), applicationId: "app_b", capability: "sms", action: "sms:send", outcome: "completed", requests: 99 },
    ]);
    expect(series.totals).toEqual({ requests: 8, failed: 1 });
    expect(series.series.map((point) => point.requests)).toEqual([0, 0, 0, 0, 2, 0, 6]);
    expect(series.byApplication).toEqual([
      { applicationId: "app_a", requests: 6, failed: 1, series: [0, 0, 0, 0, 0, 0, 6] },
      { applicationId: "app_b", requests: 2, failed: 0, series: [0, 0, 0, 0, 2, 0, 0] },
    ]);
    expect(series.byAction.map((entry) => [entry.action, entry.requests])).toEqual([
      ["email:send", 6],
      ["sms:send", 2],
    ]);
  });
});

describe("quota meters", () => {
  const environment = { id: "env_t", kind: "test" as const };
  const policy = (id: string, extra: Partial<{ scope: string; capability: string | null; windowSeconds: number; maxRequests: number; mode: string; status: string }> = {}) => ({
    id,
    scope: "project",
    capability: null,
    windowSeconds: 60,
    maxRequests: 10,
    mode: "enforce",
    status: "active",
    ...extra,
  });

  it("reads each budget's counter for the current window only", () => {
    const meters = buildQuotaMeters(
      { environment, planKey: undefined, policies: [policy("qp_a"), policy("qp_b", { status: "disabled" })], testDailyRequests: 1000 },
      [
        { budgetKey: "test-default:env_t", windowStart: new Date("2026-11-20T00:00:00Z"), requestCount: 42 },
        { budgetKey: "test-default:env_t", windowStart: new Date("2026-11-19T00:00:00Z"), requestCount: 900 },
        { budgetKey: "policy:qp_a", windowStart: new Date("2026-11-20T10:17:00Z"), requestCount: 3 },
      ],
      NOW,
    );
    expect(meters.baseBudget).toBe("test-default");
    expect(meters.meters.map((meter) => [meter.budgetKey, meter.limit, meter.used])).toEqual([
      ["test-default:env_t", 1000, 42],
      ["policy:qp_a", 10, 3],
      ["policy:qp_b", 10, null],
    ]);
    expect(meters.meters[1].windowEnd).toBe("2026-11-20T10:18:00.000Z");
  });

  it("explains a missing base budget", () => {
    const live = { id: "env_l", kind: "live" as const };
    expect(buildQuotaMeters({ environment: live, planKey: undefined, policies: [], testDailyRequests: 1000 }, [], NOW).baseBudget).toBe("live-plan-required");
    const unlimited = buildQuotaMeters({ environment: live, planKey: "enterprise", policies: [], testDailyRequests: 1000 }, [], NOW);
    expect(unlimited.baseBudget).toBe("unlimited");
    expect(unlimited.meters[0]).toMatchObject({ source: "plan", limit: null, used: null });
  });

  it("labels shared ceilings and observe mode", () => {
    const meters = buildQuotaMeters(
      { environment, planKey: "standard", policies: [policy("qp_s", { scope: "shared", mode: "observe", capability: "email" })], testDailyRequests: 1000 },
      [],
      NOW,
    );
    expect(meters.meters.map((meter) => [meter.source, meter.mode, meter.capability, meter.used])).toEqual([
      ["plan", "enforce", null, 0],
      ["shared-ceiling", "observe", "email", 0],
    ]);
  });
});

describe("quota meters and usage from the request path", () => {
  let prisma: FakeControlPlanePrisma;
  let admin: ControlPlaneAdminService;
  let quotas: QuotaService;
  let observability: ObservabilityService;
  const { privateKey } = generateKeyPairSync("ed25519");

  beforeEach(() => {
    process.env.DATABASE_ENABLED = "true";
    prisma = createFakeControlPlanePrisma();
    prisma.organization.rows.push({ id: ORG, status: "active" });
    const db = prisma as unknown as PrismaService;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
    admin = new ControlPlaneAdminService(db, audit);
    quotas = new QuotaService(db, audit);
    observability = new ObservabilityService(db);
  });

  it("counts reserved requests against the same budget keys the meters read", async () => {
    const actor = "admin@example.test";
    const project = await admin.createProject(ORG, { slug: "shop", name: "Shop" }, actor);
    const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
    await admin.setCapability(scope, "email", true, actor);
    const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
    await admin.grant(scope, app.id, { capability: "email", action: "email:send" }, actor);
    const { secret } = await admin.issueCredential(scope, app.id, { operationId: randomUUID() }, actor);
    const policy = await quotas.createProjectPolicy(ORG, project.id, { environmentKind: "test", windowSeconds: 3600, maxRequests: 50, mode: "observe" }, actor);
    const access = new ApplicationAccessService(
      prisma as unknown as PrismaService,
      new RuntimeContextSigner({ APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k" }) }),
      quotas,
    );
    for (let i = 0; i < 3; i += 1) {
      await access.authorize({ bearer: secret, capability: "email", method: "POST", relativePath: "/send", requestId: randomUUID() });
    }

    const meters = await observability.quotaMeters(scope);
    expect(meters.meters.map((meter) => [meter.source, meter.policyId, meter.used])).toEqual([
      ["test-default", null, 3],
      ["project-policy", policy.id, 3],
    ]);

    const usage = await observability.usageSeries(scope, "24h");
    expect(usage.totals.requests).toBe(3);
    expect(usage.byApplication).toEqual([expect.objectContaining({ applicationId: app.id, requests: 3 })]);
    expect(usage.byAction).toEqual([expect.objectContaining({ capability: "email", action: "email:send", requests: 3 })]);
  });

  it("refuses an environment the project does not have", async () => {
    const project = await admin.createProject(ORG, { slug: "shop", name: "Shop" }, "a@example.test");
    await expect(observability.quotaMeters({ organizationId: ORG, projectId: project.id, environmentKind: "live" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("audit log", () => {
  it("lets owners and admins read the organization and project admins their projects", () => {
    const actor = member("someone@example.test");
    const access = (organizationRole: MemberAccess["organizationRole"], roles: [string, "admin" | "developer" | "viewer"][] = []): MemberAccess => ({
      organizationRole,
      projectRoles: new Map(roles),
    });
    expect(auditScope({ kind: "platform", id: "platform" }, access(undefined))).toEqual({ kind: "organization" });
    expect(auditScope(actor, access("owner"))).toEqual({ kind: "organization" });
    expect(auditScope(actor, access("admin"))).toEqual({ kind: "organization" });
    expect(auditScope(actor, access("developer", [["prj_a", "admin"], ["prj_b", "developer"]]))).toEqual({ kind: "projects", projectIds: ["prj_a"] });
    expect(auditScope(actor, access("viewer", [["prj_b", "viewer"]]))).toBeUndefined();
    expect(auditScope(actor, access(undefined, [["prj_a", "admin"]]))).toBeUndefined();
    expect(canPerform(actor, access("developer"), "organization.audit.read")).toBe(false);
  });

  it("builds a bounded, keyset-paginated filter", () => {
    const cursor = { at: NOW, id: "5b0c6e9e-4b1f-4f7e-9a51-0c1d2e3f4a5b" };
    const where = auditLogWhere(
      { organizationId: ORG, actor: "a@example.test", action: "control_plane.credential", limit: 50 },
      { kind: "projects", projectIds: ["prj_a"] },
      cursor,
    );
    expect(where).toEqual({
      AND: [
        { organizationId: ORG },
        { projectId: { in: ["prj_a"] } },
        { actorId: "a@example.test" },
        { OR: [{ action: "control_plane.credential" }, { action: { startsWith: "control_plane.credential." } }] },
        { OR: [{ createdAt: { lt: NOW } }, { createdAt: NOW, id: { lt: cursor.id } }] },
      ],
    });
    expect(() => auditLogWhere({ from: "2026-11-20T00:00:00Z", to: "2026-11-19T00:00:00Z", limit: 50 }, { kind: "organization" }, undefined)).toThrow();
  });

  it("redacts secret fields and values at any depth", () => {
    expect(
      redactAuditDetails({
        clientSecret: "abc",
        clientId: "client-1",
        signingSecret: "whsec_x",
        nested: { token: "t", note: "whsec_abc", list: ["Bearer abc", "ok"] },
        previousSecretExpiresAt: "2026-11-21T00:00:00Z",
        key: `ak_test_${"a".repeat(16)}_${"B".repeat(43)}`,
        lookupPrefix: `ak_test_${"a".repeat(16)}`,
        planKey: "standard",
      }),
    ).toEqual({
      clientSecret: "[redacted]",
      clientId: "client-1",
      signingSecret: "[redacted]",
      nested: { token: "[redacted]", note: "[redacted]", list: ["[redacted]", "ok"] },
      previousSecretExpiresAt: "2026-11-21T00:00:00Z",
      key: "[redacted]",
      lookupPrefix: `ak_test_${"a".repeat(16)}`,
      planKey: "standard",
    });
  });

  it("shows organization-level events without an environment", () => {
    const entry = toAuditLogEntry({
      id: "e1",
      createdAt: NOW,
      organizationId: ORG,
      projectId: null,
      environment: "none",
      actorId: "owner@example.test",
      actorType: "operator",
      action: "control_plane.member.set",
      resourceType: "member",
      resourceId: `${ORG}:dev@example.test`,
      outcome: "succeeded",
      correlationId: null,
      metadata: { message: "control_plane member set", payload: { role: "developer", password: "x" } },
    });
    expect(entry).toMatchObject({ environment: null, message: "control_plane member set", details: { role: "developer", password: "[redacted]" } });
  });

  describe("routes", () => {
    let prisma: FakeControlPlanePrisma;
    let controller: ObservabilityController;
    let auditFindMany: jest.Mock;
    const req = (actor: ConsoleActor) => ({ consoleActor: actor }) as ConsoleRequest;
    const PROJECT = `prj_${"a".repeat(24)}`;
    const OTHER = `prj_${"b".repeat(24)}`;

    beforeEach(() => {
      process.env.DATABASE_ENABLED = "true";
      prisma = createFakeControlPlanePrisma();
      prisma.organization.rows.push({ id: ORG, status: "active" });
      prisma.cpProject.rows.push({ id: PROJECT, organizationId: ORG, slug: "a" }, { id: OTHER, organizationId: ORG, slug: "b" });
      for (const [email, role] of [
        ["owner@example.test", "owner"],
        ["dev@example.test", "developer"],
        ["viewer@example.test", "viewer"],
      ]) {
        prisma.organizationMember.rows.push({ organizationId: ORG, email, role, status: "active", subject: null });
      }
      prisma.cpProjectRoleAssignment.rows.push({ id: "pra_1", organizationId: ORG, projectId: PROJECT, memberEmail: "dev@example.test", teamId: null, role: "admin" });
      auditFindMany = jest.fn().mockResolvedValue([]);
      const db = Object.assign(prisma, { auditEvent: { findMany: auditFindMany } }) as unknown as PrismaService;
      controller = new ObservabilityController(new ObservabilityService(db), new ConsoleAccessService(db));
    });

    it("limits a project admin to their projects", async () => {
      await controller.organizationAudit(ORG, {}, req(member("dev@example.test")));
      expect(auditFindMany.mock.calls[0][0].where.AND).toEqual([{ organizationId: ORG }, { projectId: { in: [PROJECT] } }]);
      await expect(controller.organizationAudit(ORG, { projectId: OTHER }, req(member("dev@example.test")))).rejects.toMatchObject({ status: 404 });
    });

    it("refuses members who administer nothing, and non-members", async () => {
      await expect(controller.organizationAudit(ORG, {}, req(member("viewer@example.test")))).rejects.toMatchObject({ status: 403 });
      await expect(controller.organizationAudit(ORG, {}, req(member("stranger@example.test")))).rejects.toMatchObject({ status: 404 });
    });

    it("lets owners filter by any project of the organization, not another organization's", async () => {
      await controller.organizationAudit(ORG, { projectId: OTHER, limit: "10" }, req(member("owner@example.test")));
      expect(auditFindMany.mock.calls[0][0]).toMatchObject({ take: 11, where: { AND: [{ organizationId: ORG }, { projectId: OTHER }] } });
      await expect(controller.organizationAudit(ORG, { projectId: `prj_${"c".repeat(24)}` }, req(member("owner@example.test")))).rejects.toMatchObject({
        status: 404,
      });
    });

    it("keeps the platform audit log for platform operators", async () => {
      await expect(controller.platformAudit({}, req(member("owner@example.test")))).rejects.toMatchObject({ status: 403 });
      await controller.platformAudit({ organizationId: ORG }, req({ kind: "platform", id: "platform" }));
      expect(auditFindMany.mock.calls[0][0].where.AND).toEqual([{ organizationId: ORG }]);
    });
  });
});

describe("audit writes", () => {
  it("store the owning organization and project, and 'none' for organization-level events", async () => {
    process.env.DATABASE_ENABLED = "true";
    const create = jest.fn().mockResolvedValue(undefined);
    const logger = { warn: jest.fn() };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AuditEventsService: Service } = require("../../../../apps/gateway/src/domains/compliance/audit/audit-events.service");
    const service = new Service(logger, { auditEvent: { create } });
    await service.record({ type: "control_plane.member.set", actor: "owner@example.test", organizationId: ORG, severity: "info", message: "m" });
    await service.record({ type: "control_plane.grant.created", actor: "a@example.test", organizationId: ORG, projectId: "prj_x", environment: "live", severity: "info", message: "m" });
    expect(create.mock.calls.map(([{ data }]) => [data.organizationId, data.projectId, data.environment])).toEqual([
      [ORG, null, "none"],
      [ORG, "prj_x", "live"],
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
