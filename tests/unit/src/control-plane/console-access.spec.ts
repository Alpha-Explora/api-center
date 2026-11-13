import { randomUUID } from "node:crypto";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import type { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import type { ScopedAdminGuard } from "../../../../apps/gateway/src/domains/auth-security/auth/guards/scoped-admin.guard";
import { ControlPlaneAdminController } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.controller";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ConsoleAccessService } from "../../../../apps/gateway/src/domains/control-plane/console-access.service";
import { OrganizationPeopleService } from "../../../../apps/gateway/src/domains/control-plane/organization-people.service";
import { QuotaService } from "../../../../apps/gateway/src/domains/control-plane/quota.service";
import { ConsoleActorGuard, type ConsoleRequest } from "../../../../apps/gateway/src/domains/control-plane/console-actor.guard";
import { canPerform, type ConsoleActor, type MemberAccess } from "../../../../apps/gateway/src/domains/control-plane/console-access.policy";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000c1";
const OTHER_ORG = "6f1c1d1e-0000-4000-8000-0000000000c2";
const platform: ConsoleActor = { kind: "platform", id: "platform" };
const member = (email: string, subject = `sub-${email}`): ConsoleActor => ({ kind: "member", email, subject, platformAdmin: false });

let prisma: FakeControlPlanePrisma;
let controller: ControlPlaneAdminController;

function req(actor: ConsoleActor): ConsoleRequest {
  return { consoleActor: actor } as ConsoleRequest;
}

beforeAll(() => {
  process.env.DATABASE_ENABLED = "true";
});

beforeEach(() => {
  prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, status: "active" }, { id: OTHER_ORG, status: "active" });
  for (const [email, role] of [
    ["owner@example.test", "owner"],
    ["admin@example.test", "admin"],
    ["dev@example.test", "operator"],
    ["viewer@example.test", "observer"],
    ["dev2@example.test", "developer"],
  ]) {
    prisma.organizationMember.rows.push({ organizationId: ORG, email, role, status: "active", subject: null });
  }
  const db = prisma as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
  controller = new ControlPlaneAdminController(
    new ControlPlaneAdminService(db, audit),
    new ConsoleAccessService(db),
    new OrganizationPeopleService(db, audit),
    new QuotaService(db, audit),
  );
});

async function createProject(actor: ConsoleActor, slug = "serbizio") {
  return (await controller.createProject(ORG, { slug, name: slug }, req(actor))).data;
}

function env(projectId: string, environment = "test") {
  return { organizationId: ORG, projectId, environment };
}

describe("console role matrix", () => {
  const none: MemberAccess = { organizationRole: undefined, projectRoles: new Map() };

  it("gives platform callers and platform admins everything", () => {
    expect(canPerform(platform, none, "organization.owners.manage")).toBe(true);
    expect(canPerform({ ...member("ops@example.test"), platformAdmin: true } as ConsoleActor, none, "project.manage", { projectId: "p" })).toBe(true);
  });

  it("denies everything to non-members", () => {
    expect(canPerform(member("x@example.test"), none, "organization.read")).toBe(false);
  });

  it("lets developers configure test but only read live", () => {
    const access: MemberAccess = { organizationRole: "developer", projectRoles: new Map([["p", "developer"]]) };
    const actor = member("dev@example.test");
    expect(canPerform(actor, access, "environment.write", { projectId: "p", environmentKind: "test" })).toBe(true);
    expect(canPerform(actor, access, "environment.write", { projectId: "p", environmentKind: "live" })).toBe(false);
    expect(canPerform(actor, access, "environment.read", { projectId: "p", environmentKind: "live" })).toBe(true);
    expect(canPerform(actor, access, "project.manage", { projectId: "p" })).toBe(false);
    expect(canPerform(actor, access, "environment.read", { projectId: "other" })).toBe(false);
  });

  it("keeps owner membership changes to owners", () => {
    const admin: MemberAccess = { organizationRole: "admin", projectRoles: new Map() };
    expect(canPerform(member("a@example.test"), admin, "organization.members.manage")).toBe(true);
    expect(canPerform(member("a@example.test"), admin, "organization.owners.manage")).toBe(false);
  });
});

describe("console access through the control plane API", () => {
  it("makes a developer who creates a project its administrator, invisible to other developers", async () => {
    const project = await createProject(member("dev@example.test"));
    expect(prisma.cpProjectRoleAssignment.rows).toMatchObject([{ projectId: project.id, memberEmail: "dev@example.test", role: "admin" }]);

    const mine = await controller.listProjects(ORG, req(member("dev@example.test")));
    const theirs = await controller.listProjects(ORG, req(member("dev2@example.test")));
    expect(mine.data.map((p) => p.id)).toEqual([project.id]);
    expect(theirs.data).toEqual([]);
    await expect(controller.getProject({ organizationId: ORG, projectId: project.id }, req(member("dev2@example.test")))).rejects.toMatchObject({
      status: 404,
    });
  });

  it("does not let viewers create projects", async () => {
    await expect(createProject(member("viewer@example.test"))).rejects.toMatchObject({ status: 403 });
  });

  it("hides an organization from people who are not its members", async () => {
    await expect(controller.listProjects(OTHER_ORG, req(member("dev@example.test")))).rejects.toMatchObject({ status: 404 });
  });

  it("grants project access through teams, at the team's role", async () => {
    const project = await createProject(platform);
    const team = (await controller.createTeam(ORG, { slug: "payments", name: "Payments" }, req(member("admin@example.test")))).data;
    await controller.addTeamMember({ organizationId: ORG, teamId: team.id, email: "dev2@example.test" }, req(member("admin@example.test")));
    await controller.setProjectRole(
      { organizationId: ORG, projectId: project.id },
      { teamId: team.id, role: "developer" },
      req(member("admin@example.test")),
    );

    const dev2 = req(member("dev2@example.test"));
    await expect(
      controller.createApplication({ ...env(project.id), environment: "test" }, { slug: "api", name: "API" }, dev2),
    ).resolves.toMatchObject({ success: true });
    await expect(controller.setProjectRole({ organizationId: ORG, projectId: project.id }, { memberEmail: "viewer@example.test", role: "viewer" }, dev2)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("lets a project developer issue test credentials but not change live", async () => {
    const project = await createProject(member("dev@example.test"));
    await controller.setProjectRole({ organizationId: ORG, projectId: project.id }, { memberEmail: "dev2@example.test", role: "developer" }, req(member("dev@example.test")));
    const dev2 = req(member("dev2@example.test"));
    const app = (await controller.createApplication(env(project.id), { slug: "api", name: "API" }, dev2)).data;
    await expect(
      controller.issueCredential({ ...env(project.id), applicationId: app.id }, { operationId: randomUUID() }, dev2),
    ).resolves.toMatchObject({ data: { secret: expect.stringMatching(/^ak_test_/) } });
    await expect(controller.createApplication(env(project.id, "live"), { slug: "api", name: "API" }, dev2)).rejects.toMatchObject({ status: 403 });
  });

  it("protects owners: admins cannot change them and the last owner cannot leave", async () => {
    const admin = req(member("admin@example.test"));
    await expect(controller.setMember({ organizationId: ORG, email: "owner@example.test" }, { role: "admin" }, admin)).rejects.toMatchObject({ status: 403 });
    await expect(controller.setMember({ organizationId: ORG, email: "dev@example.test" }, { role: "owner" }, admin)).rejects.toMatchObject({ status: 403 });
    await expect(controller.removeMember({ organizationId: ORG, email: "owner@example.test" }, req(member("owner@example.test")))).rejects.toMatchObject({
      code: "LAST_OWNER",
    });
    await controller.setMember({ organizationId: ORG, email: "admin@example.test" }, { role: "owner" }, req(member("owner@example.test")));
    await expect(controller.removeMember({ organizationId: ORG, email: "owner@example.test" }, req(member("owner@example.test")))).resolves.toMatchObject({
      success: true,
    });
  });

  it("links the verified identity on first use and rejects a different identity for the same email afterwards", async () => {
    await controller.me(ORG, req(member("dev@example.test", "google-sub-1")));
    expect(prisma.organizationMember.rows.find((row) => row.email === "dev@example.test")?.subject).toBe("google-sub-1");
    await expect(controller.me(ORG, req(member("dev@example.test", "google-sub-2")))).rejects.toMatchObject({ status: 404 });
  });

  it("reads legacy roles with their new meaning", async () => {
    const me = await controller.me(ORG, req(member("viewer@example.test")));
    expect(me.data.organizationRole).toBe("viewer");
  });
});

describe("ConsoleActorGuard", () => {
  function context(headers: Record<string, string>) {
    const request = { headers } as unknown as ConsoleRequest;
    return { request, ctx: { switchToHttp: () => ({ getRequest: () => request }) } as never };
  }
  const platformGuard = { canActivate: jest.fn().mockResolvedValue(true) } as unknown as ScopedAdminGuard;
  const config = { platformAdminEmails: ["ops@example.test"] } as unknown as ConfigService;

  it("acts as the verified member when the console forwards a user token", async () => {
    const verifier = jest.fn().mockResolvedValue({ email: "ops@example.test", subject: "s1" });
    const guard = new ConsoleActorGuard(platformGuard, config, verifier);
    const { request, ctx } = context({ "x-apicenter-user-token": "google-id-token" });
    await guard.canActivate(ctx);
    expect(verifier).toHaveBeenCalledWith("google-id-token");
    expect(request.consoleActor).toEqual({ kind: "member", email: "ops@example.test", subject: "s1", platformAdmin: true });
  });

  it("acts as the platform without a user token, and never without platform authentication", async () => {
    const guard = new ConsoleActorGuard(platformGuard, config, jest.fn());
    const { request, ctx } = context({});
    await guard.canActivate(ctx);
    expect(request.consoleActor).toEqual({ kind: "platform", id: "platform" });

    const rejecting = { canActivate: jest.fn().mockRejectedValue(new Error("Admin access requires…")) } as unknown as ScopedAdminGuard;
    await expect(new ConsoleActorGuard(rejecting, config, jest.fn()).canActivate(context({ "x-apicenter-user-token": "t" }).ctx)).rejects.toThrow();
  });

  it("rejects an invalid user token instead of falling back to platform access", async () => {
    const guard = new ConsoleActorGuard(platformGuard, config, jest.fn().mockRejectedValue(Object.assign(new Error("invalid"), { status: 401 })));
    await expect(guard.canActivate(context({ "x-apicenter-user-token": "forged" }).ctx)).rejects.toMatchObject({ status: 401 });
  });
});
