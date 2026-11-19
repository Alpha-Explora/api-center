// Quota policy edit and soft delete, outgoing API access requests with rejection reasons, and the
// workload audiences route.
import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ApplicationAccessService } from "../../../../apps/gateway/src/domains/control-plane/application-access.service";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { QuotaService } from "../../../../apps/gateway/src/domains/control-plane/quota.service";
import { PublishedApiService } from "../../../../apps/gateway/src/domains/control-plane/published-api.service";
import { ConsoleAccessService } from "../../../../apps/gateway/src/domains/control-plane/console-access.service";
import { QuotaPoliciesController } from "../../../../apps/gateway/src/domains/control-plane/quota-policies.controller";
import { ConsumerAccessController } from "../../../../apps/gateway/src/domains/control-plane/consumer-access.controller";
import { ControlPlaneAdminController } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.controller";
import { ObservabilityService } from "../../../../apps/gateway/src/domains/control-plane/observability/observability.service";
import type { ConsoleRequest } from "../../../../apps/gateway/src/domains/control-plane/console-actor.guard";
import type { ConsoleActor } from "../../../../apps/gateway/src/domains/control-plane/console-access.policy";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-000000000501";
const OTHER_ORG = "6f1c1d1e-0000-4000-8000-000000000502";
const actor = "admin@example.test";
const platform: ConsoleActor = { kind: "platform", id: "platform" };
const member = (email: string): ConsoleActor => ({ kind: "member", email, subject: `sub-${email}`, platformAdmin: false });
const req = (who: ConsoleActor) => ({ consoleActor: who }) as ConsoleRequest;
const { privateKey } = generateKeyPairSync("ed25519");

let prisma: FakeControlPlanePrisma;
let audit: { record: jest.Mock };
let admin: ControlPlaneAdminService;
let quotas: QuotaService;
let apis: PublishedApiService;
let consoleAccess: ConsoleAccessService;

beforeEach(() => {
  process.env.DATABASE_ENABLED = "true";
  process.env.CONTROL_PLANE_ALLOW_PRIVATE_UPSTREAMS = "true";
  prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, status: "active" }, { id: OTHER_ORG, status: "active" });
  for (const [email, role] of [
    ["owner@example.test", "owner"],
    ["dev@example.test", "developer"],
    ["viewer@example.test", "viewer"],
  ]) {
    prisma.organizationMember.rows.push({ organizationId: ORG, email, role, status: "active", subject: null });
  }
  const db = prisma as unknown as PrismaService;
  audit = { record: jest.fn().mockResolvedValue(undefined) };
  admin = new ControlPlaneAdminService(db, audit as unknown as AuditEventsService);
  quotas = new QuotaService(db, audit as unknown as AuditEventsService);
  apis = new PublishedApiService(db, audit as unknown as AuditEventsService);
  consoleAccess = new ConsoleAccessService(db);
});

afterEach(() => {
  delete process.env.CONTROL_PLANE_ALLOW_PRIVATE_UPSTREAMS;
  delete process.env.CONTROL_PLANE_WORKLOAD_AUDIENCES;
  delete process.env.CONTROL_PLANE_TEST_DAILY_REQUESTS;
});

describe("quota policy edit and delete", () => {
  async function projectPolicy() {
    const project = await admin.createProject(ORG, { slug: "shop", name: "Shop" }, actor);
    await prisma.cpProjectRoleAssignment.create({
      data: { id: "pra_dev", organizationId: ORG, projectId: project.id, memberEmail: "dev@example.test", teamId: null, role: "developer" },
    });
    const policy = await quotas.createProjectPolicy(ORG, project.id, { environmentKind: "test", windowSeconds: 60, maxRequests: 100, mode: "enforce" }, actor);
    return { project, policy };
  }
  const controller = () => new QuotaPoliciesController(quotas, consoleAccess);
  const params = (policyId: string, organizationId = ORG) => ({ organizationId, policyId });

  it("changes window, limit, mode and capability, and audits the values before and after", async () => {
    const { project, policy } = await projectPolicy();
    const updated = await controller().update(params(policy.id), { windowSeconds: 3600, maxRequests: 5, mode: "observe", capability: "email" }, req(member("owner@example.test")));
    expect(updated.data).toMatchObject({ windowSeconds: 3600, maxRequests: 5, mode: "observe", capability: "email", updatedBy: "owner@example.test" });

    const event = audit.record.mock.calls.map(([record]) => record).find((record) => record.type === "control_plane.quota.updated");
    expect(event).toMatchObject({
      organizationId: ORG,
      projectId: project.id,
      payload: {
        before: { windowSeconds: 60, maxRequests: 100, mode: "enforce", capability: null },
        after: { windowSeconds: 3600, maxRequests: 5, mode: "observe", capability: "email" },
      },
    });

    await controller().update(params(policy.id), { capability: null }, req(platform));
    expect(prisma.cpQuotaPolicy.rows[0]).toMatchObject({ capability: null });
  });

  it("validates the change", async () => {
    const { policy } = await projectPolicy();
    const owner = req(member("owner@example.test"));
    await expect(controller().update(params(policy.id), {}, owner)).rejects.toMatchObject({ status: 400 });
    await expect(controller().update(params(policy.id), { actor: "x" }, owner)).rejects.toMatchObject({ status: 400 });
    await expect(controller().update(params(policy.id), { maxRequests: 0 }, owner)).rejects.toMatchObject({ status: 400 });
    await expect(controller().update(params(policy.id), { environmentKind: "live" }, owner)).rejects.toMatchObject({ status: 400 });
    await expect(controller().update(params(policy.id), { capability: "nope" }, owner)).rejects.toMatchObject({ status: 400 });
    await expect(controller().update(params("not-a-policy"), { maxRequests: 1 }, owner)).rejects.toMatchObject({ status: 400 });
  });

  it("needs project.manage for a project policy and organization.quotas.manage for a shared ceiling", async () => {
    const { project, policy } = await projectPolicy();
    await expect(controller().update(params(policy.id), { maxRequests: 1 }, req(member("dev@example.test")))).rejects.toMatchObject({ status: 403 });
    await expect(controller().remove(params(policy.id), req(member("dev@example.test")))).rejects.toMatchObject({ status: 403 });
    // A viewer without a project role cannot even see the project.
    await expect(controller().remove(params(policy.id), req(member("viewer@example.test")))).rejects.toMatchObject({ status: 404 });

    const shared = await quotas.createSharedPolicy(ORG, [project.id], { environmentKind: "test", windowSeconds: 60, maxRequests: 10, mode: "enforce" }, actor);
    await prisma.cpProjectRoleAssignment.create({
      data: { id: "pra_dev_admin", organizationId: ORG, projectId: project.id, memberEmail: "dev@example.test", teamId: null, role: "admin" },
    });
    await expect(controller().update(params(policy.id), { maxRequests: 1 }, req(member("dev@example.test")))).resolves.toBeDefined();
    await expect(controller().update(params(shared.id), { maxRequests: 1 }, req(member("dev@example.test")))).rejects.toMatchObject({ status: 403 });
    await expect(controller().update(params(shared.id), { maxRequests: 1 }, req(member("owner@example.test")))).resolves.toBeDefined();
  });

  it("hides another organization's policy and policies of organizations the caller is not in", async () => {
    const { policy } = await projectPolicy();
    await expect(controller().update(params(policy.id, OTHER_ORG), { maxRequests: 1 }, req(platform))).rejects.toMatchObject({ status: 404 });
    await expect(controller().remove(params(policy.id), req(member("stranger@example.test")))).rejects.toMatchObject({
      status: 404,
      message: `Organization '${ORG}' was not found`,
    });
  });

  it("soft-deletes: the row stays for the audit trail, but nothing lists, edits or enforces it", async () => {
    process.env.CONTROL_PLANE_TEST_DAILY_REQUESTS = "1000";
    const { project, policy } = await projectPolicy();
    const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
    await admin.setCapability(scope, "email", true, actor);
    const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
    await admin.grant(scope, app.id, { capability: "email", action: "email:send" }, actor);
    const { secret } = await admin.issueCredential(scope, app.id, { operationId: randomUUID() }, actor);
    const access = new ApplicationAccessService(
      prisma as unknown as PrismaService,
      new RuntimeContextSigner({ APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k" }) }),
      quotas,
    );
    const send = () => access.authorize({ bearer: secret, capability: "email", method: "POST", relativePath: "/send", requestId: randomUUID() });
    await quotas.updatePolicy(ORG, policy.id, { maxRequests: 1 }, actor);
    await send();
    await expect(send()).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });

    await expect(controller().remove(params(policy.id), req(member("owner@example.test")))).resolves.toMatchObject({ data: { id: policy.id, deleted: true } });
    expect(prisma.cpQuotaPolicy.rows[0]).toMatchObject({ id: policy.id, status: "deleted", deletedBy: "owner@example.test", deletedAt: expect.any(Date) });
    expect(audit.record.mock.calls.map(([record]) => record.type)).toContain("control_plane.quota.deleted");

    await expect(send()).resolves.toBeDefined();
    expect(await quotas.listPolicies(ORG)).toEqual([]);
    expect(await quotas.listPolicies(ORG, project.id)).toEqual([]);
    const meters = await new ObservabilityService(prisma as unknown as PrismaService, {} as never, {} as never).quotaMeters(scope);
    expect(JSON.stringify(meters)).not.toContain(policy.id);
    await expect(controller().remove(params(policy.id), req(member("owner@example.test")))).rejects.toMatchObject({ status: 404 });
    await expect(controller().update(params(policy.id), { maxRequests: 9 }, req(member("owner@example.test")))).rejects.toMatchObject({ status: 404 });
    await expect(quotas.setPolicyStatus(ORG, policy.id, "active", actor)).rejects.toMatchObject({ status: 404 });
  });
});

describe("outgoing API access requests", () => {
  async function projectWithApp(slug: string) {
    const project = await admin.createProject(ORG, { slug, name: slug }, actor);
    const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
    const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
    return { project, scope, app };
  }

  async function requested() {
    const owner = await projectWithApp("orders");
    const api = await apis.publish(
      owner.scope,
      { slug: "orders", name: "Orders", upstreamUrl: "http://orders.internal:8080", operations: [{ method: "GET", path: "/orders", action: "orders:read" }] },
      actor,
    );
    const consumer = await projectWithApp("storefront");
    const outcome = await apis.requestAccess(consumer.scope, consumer.app.id, api.id, "orders:read", "dev@example.test");
    if (outcome.kind !== "requested") throw new Error("expected a request");
    return { owner, api, consumer, request: outcome.request };
  }

  function adminController() {
    return new ControlPlaneAdminController(admin, consoleAccess, {} as never, quotas, {} as never, {} as never, apis, {} as never);
  }

  it("lists a project's requests with the API's name and status, and only that project's", async () => {
    const { api, consumer, owner } = await requested();
    const outgoing = await new ConsumerAccessController(apis, consoleAccess).outgoing(
      { organizationId: ORG, projectId: consumer.project.id },
      req(member("owner@example.test")),
    );
    expect(outgoing.data).toEqual([
      expect.objectContaining({ apiId: api.id, action: "orders:read", status: "pending", api: expect.objectContaining({ name: "Orders", projectId: owner.project.id }) }),
    ]);
    expect(await apis.listOutgoingRequests(ORG, owner.project.id)).toEqual([]);
  });

  it("stores a rejection reason for the requester, never for an approval", async () => {
    const { request, consumer } = await requested();
    const routes = adminController();
    const params = { organizationId: ORG, requestId: request.id };
    await expect(routes.decideApiAccess(params, { approve: true, reason: "because" }, req(platform))).rejects.toMatchObject({ status: 400 });
    await expect(routes.decideApiAccess(params, { approve: false, reason: "x".repeat(501) }, req(platform))).rejects.toMatchObject({ status: 400 });

    await routes.decideApiAccess(params, { approve: false, reason: "  Use the read replica API instead  " }, req(member("owner@example.test")));
    const [outgoing] = await apis.listOutgoingRequests(ORG, consumer.project.id);
    expect(outgoing).toMatchObject({ status: "rejected", rejectionReason: "Use the read replica API instead", decidedBy: "owner@example.test" });
    const event = audit.record.mock.calls.map(([record]) => record).find((record) => record.type === "control_plane.api_access.rejected");
    expect(event?.payload).toMatchObject({ reason: "Use the read replica API instead" });
  });

  it("keeps a rejection without a reason, and approvals clear nothing they should not", async () => {
    const { request, consumer } = await requested();
    await apis.decide(ORG, request.id, false, actor);
    expect((await apis.listOutgoingRequests(ORG, consumer.project.id))[0]).toMatchObject({ status: "rejected", rejectionReason: null });

    const again = await apis.requestAccess(consumer.scope, consumer.app.id, request.apiId, "orders:read", "dev@example.test");
    if (again.kind !== "requested") throw new Error("expected a request");
    await apis.decide(ORG, again.request.id, true, actor, "ignored");
    expect(prisma.cpApiAccessRequest.rows.find((row) => row.id === again.request.id)).toMatchObject({ status: "approved", rejectionReason: null });
  });

  it("shows outgoing requests only to people who can read the consumer project", async () => {
    const { consumer } = await requested();
    const routes = new ConsumerAccessController(apis, consoleAccess);
    await expect(routes.outgoing({ organizationId: ORG, projectId: consumer.project.id }, req(member("viewer@example.test")))).rejects.toMatchObject({ status: 404 });
    await expect(routes.outgoing({ organizationId: OTHER_ORG, projectId: consumer.project.id }, req(platform))).rejects.toMatchObject({ status: 404 });
    await expect(routes.outgoing({ organizationId: ORG, projectId: "prj_bad" }, req(platform))).rejects.toMatchObject({ status: 400 });
  });
});

describe("workload audiences", () => {
  it("returns the gateway's configured audiences to organization members", async () => {
    process.env.CONTROL_PLANE_WORKLOAD_AUDIENCES = " https://gateway.example.test , apicenter-workloads ,";
    const routes = new ConsumerAccessController(apis, consoleAccess);
    await expect(routes.audiences(ORG, req(member("viewer@example.test")))).resolves.toEqual({
      success: true,
      data: { audiences: ["https://gateway.example.test", "apicenter-workloads"] },
    });
    await expect(routes.audiences(ORG, req(member("stranger@example.test")))).rejects.toMatchObject({ status: 404 });
  });

  it("returns an empty list when workload identity is not configured", async () => {
    const routes = new ConsumerAccessController(apis, consoleAccess);
    await expect(routes.audiences(ORG, req(platform))).resolves.toEqual({ success: true, data: { audiences: [] } });
  });
});
