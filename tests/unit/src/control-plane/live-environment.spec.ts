import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import type { ApprovalRequestService } from "../../../../apps/gateway/src/domains/governance/approvals/approval-request.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ApplicationAccessService } from "../../../../apps/gateway/src/domains/control-plane/application-access.service";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { QuotaService } from "../../../../apps/gateway/src/domains/control-plane/quota.service";
import { LiveEnvironmentService } from "../../../../apps/gateway/src/domains/control-plane/live-environment.service";
import { CapabilityConfigurationService } from "../../../../apps/gateway/src/domains/control-plane/capability-configuration.service";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000e1";
const actor = "admin@example.test";

let prisma: FakeControlPlanePrisma;
let admin: ControlPlaneAdminService;
let quotas: QuotaService;
let live: LiveEnvironmentService;
let access: ApplicationAccessService;
let approvals: { assertApprovedForAction: jest.Mock };
const { privateKey } = generateKeyPairSync("ed25519");

beforeEach(() => {
  process.env.DATABASE_ENABLED = "true";
  prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, status: "active" });
  const db = prisma as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
  approvals = { assertApprovedForAction: jest.fn().mockResolvedValue({ status: "applied" }) };
  admin = new ControlPlaneAdminService(db, audit);
  quotas = new QuotaService(db, audit);
  live = new LiveEnvironmentService(db, approvals as unknown as ApprovalRequestService, audit);
  access = new ApplicationAccessService(
    db,
    new RuntimeContextSigner({ APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k" }) }),
    quotas,
  );
});

async function projectWithLive() {
  const project = await admin.createProject(ORG, { slug: "serbizio", name: "Serbizio" }, actor);
  const environment = await live.provision(ORG, project.id, actor);
  return { project, environment, scope: { organizationId: ORG, projectId: project.id, environmentKind: "live" as const } };
}

describe("live environments", () => {
  it("starts in provisioning and lists what is missing", async () => {
    const { project, environment } = await projectWithLive();
    expect(environment.status).toBe("provisioning");
    const readiness = await live.readiness(ORG, project.id);
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.filter((check) => !check.passed).map((check) => check.key)).toEqual(["plan", "capability", "application", "grant"]);
  });

  it("refuses a second live environment", async () => {
    const { project } = await projectWithLive();
    await expect(live.provision(ORG, project.id, actor)).rejects.toMatchObject({ status: 409 });
  });

  it("prepares live identities but issues no live credential before activation", async () => {
    const { scope } = await projectWithLive();
    const app = await admin.createApplication(scope, { slug: "api", name: "API (live)" }, actor);
    await expect(admin.issueCredential(scope, app.id, { operationId: randomUUID() }, actor)).rejects.toMatchObject({
      code: "LIVE_ENVIRONMENT_NOT_ACTIVE",
    });
  });

  it("activates only when ready, consuming the project's approval, and then serves live requests", async () => {
    const { project, scope } = await projectWithLive();
    await expect(live.activate(ORG, project.id, "apr_1", actor)).rejects.toMatchObject({ code: "LIVE_NOT_READY" });
    expect(approvals.assertApprovedForAction).not.toHaveBeenCalled();

    await quotas.assignPlan(scope, "standard", actor);
    await admin.setCapability(scope, "email", true, actor);
    const app = await admin.createApplication(scope, { slug: "api", name: "API (live)" }, actor);
    await admin.grant(scope, app.id, { capability: "email", action: "email:send" }, actor);
    expect((await live.readiness(ORG, project.id)).ready).toBe(true);

    const activated = await live.activate(ORG, project.id, "apr_1", actor);
    expect(activated).toMatchObject({ status: "active", activationApprovalId: "apr_1", activatedBy: actor });
    expect(approvals.assertApprovedForAction).toHaveBeenCalledWith(
      { approvalRequestId: "apr_1", actionType: "environment.activate_live", targetEnvironment: "live", targetId: project.id, requireTarget: true },
      expect.anything(),
    );

    const { secret } = await admin.issueCredential(scope, app.id, { operationId: randomUUID() }, actor);
    expect(secret).toMatch(/^ak_live_/);
    const call = await access.authorize({ bearer: secret, capability: "email", method: "POST", relativePath: "/send", requestId: randomUUID() });
    expect(call.identity.environmentKind).toBe("live");
  });

  it("does not activate when the approval is rejected", async () => {
    const { project, scope } = await projectWithLive();
    await quotas.assignPlan(scope, "standard", actor);
    await admin.setCapability(scope, "email", true, actor);
    const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
    await admin.grant(scope, app.id, { capability: "email", action: "email:send" }, actor);
    approvals.assertApprovedForAction.mockRejectedValue(Object.assign(new Error("Approval request target does not match"), { status: 403 }));
    await expect(live.activate(ORG, project.id, "apr_other", actor)).rejects.toThrow("target does not match");
    expect((await live.readiness(ORG, project.id)).status).toBe("provisioning");
  });

  it("suspends and resumes an activated environment, blocking requests while suspended", async () => {
    const { project, scope } = await projectWithLive();
    await expect(live.setStatus(ORG, project.id, "live", "suspended", actor)).rejects.toMatchObject({ code: "LIVE_NOT_ACTIVATED" });
    const testScope = { ...scope, environmentKind: "test" as const };
    await admin.setCapability(testScope, "email", true, actor);
    const app = await admin.createApplication(testScope, { slug: "api", name: "API" }, actor);
    await admin.grant(testScope, app.id, { capability: "email", action: "email:send" }, actor);
    const { secret } = await admin.issueCredential(testScope, app.id, { operationId: randomUUID() }, actor);
    const send = () => access.authorize({ bearer: secret, capability: "email", method: "POST", relativePath: "/send", requestId: randomUUID() });
    await live.setStatus(ORG, project.id, "test", "suspended", actor);
    await expect(send()).rejects.toMatchObject({ code: "ENVIRONMENT_INACTIVE" });
    await live.setStatus(ORG, project.id, "test", "active", actor);
    await expect(send()).resolves.toBeDefined();
  });
});

describe("capability configuration", () => {
  it("forwards the email sender for a control-plane project with the admin token, auditing only safe fields", async () => {
    const audit = { record: jest.fn().mockResolvedValue(undefined) };
    const service = new CapabilityConfigurationService(prisma as unknown as PrismaService, audit as unknown as AuditEventsService);
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
    service.useFetch(fetchImpl);
    process.env.EMAIL_ADMIN_TOKEN = "email-admin-token";
    process.env.SHARED_SERVICE_ROUTE_EMAIL_TEST = "http://email.internal:4012/";
    const project = await admin.createProject(ORG, { slug: "cfg", name: "Cfg" }, actor);
    const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };

    await service.configure(scope, "email", "PUT", { fromAddress: "hello@serbizio.example", dailyLimit: 200, apiKey: "should-not-be-audited" }, actor);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`http://email.internal:4012/admin/projects/${project.id}/email-sender/test`);
    expect(init.headers["X-APICenter-Email-Admin-Token"]).toBe("email-admin-token");
    expect(audit.record.mock.calls[0][0].payload).toEqual({ fromAddress: "hello@serbizio.example", dailyLimit: 200 });
    await expect(service.configure(scope, "sms", "PUT", {}, actor)).rejects.toMatchObject({ status: 404 });
    await expect(
      service.configure({ ...scope, projectId: "prj_zzzzzzzzzzzzzzzzzzzzzzzz" }, "email", "PUT", {}, actor),
    ).rejects.toMatchObject({ status: 404 });
  });
});
