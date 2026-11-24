// A project named in a console request must belong to the organization in the path, whoever asks.
// The role policy alone treats an organization owner or admin as admin of any project ID.
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ConsoleAccessService } from "../../../../apps/gateway/src/domains/control-plane/console-access.service";
import { ControlPlaneAdminController } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.controller";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { OrganizationPeopleService } from "../../../../apps/gateway/src/domains/control-plane/organization-people.service";
import { QuotaService } from "../../../../apps/gateway/src/domains/control-plane/quota.service";
import type { ConsoleRequest } from "../../../../apps/gateway/src/domains/control-plane/console-actor.guard";
import type { ConsoleAction, ConsoleActor } from "../../../../apps/gateway/src/domains/control-plane/console-access.policy";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000d1";
const OTHER_ORG = "6f1c1d1e-0000-4000-8000-0000000000d2";
const OWN_PROJECT = "prj_own000000000000000000001";
const FOREIGN_PROJECT = "prj_foreign00000000000000001";
const MISSING_PROJECT = "prj_missing00000000000000001";

const member = (email: string, platformAdmin = false): ConsoleActor => ({ kind: "member", email, subject: `sub-${email}`, platformAdmin });
const ACTORS: Array<[string, ConsoleActor]> = [
  ["a platform caller", { kind: "platform", id: "platform" }],
  ["a platform admin", member("ops@example.test", true)],
  ["an organization owner", member("owner@example.test")],
  ["an organization admin", member("admin@example.test")],
  ["the foreign project's own admin", member("both@example.test")],
];
const PROJECT_ACTIONS: Array<[ConsoleAction, "test" | "live" | undefined]> = [
  ["project.read", undefined],
  ["project.manage", undefined],
  ["environment.read", "test"],
  ["environment.read", "live"],
  ["environment.write", "test"],
  ["environment.write", "live"],
];

let prisma: FakeControlPlanePrisma;
let access: ConsoleAccessService;

beforeAll(() => {
  process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/apicenter_test";
});

beforeEach(() => {
  prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, status: "active" }, { id: OTHER_ORG, status: "active" });
  prisma.cpProject.rows.push(
    { id: OWN_PROJECT, organizationId: ORG, slug: "own", name: "Own", status: "active" },
    { id: FOREIGN_PROJECT, organizationId: OTHER_ORG, slug: "foreign", name: "Foreign", status: "active" },
  );
  for (const [email, role] of [
    ["owner@example.test", "owner"],
    ["admin@example.test", "admin"],
    ["dev@example.test", "developer"],
    ["both@example.test", "owner"],
  ]) {
    prisma.organizationMember.rows.push({ organizationId: ORG, email, role, status: "active", subject: null });
  }
  // both@ also administers the foreign project in its own organization; that must not carry over.
  prisma.organizationMember.rows.push({ organizationId: OTHER_ORG, email: "both@example.test", role: "owner", status: "active", subject: null });
  prisma.cpProjectRoleAssignment.rows.push(
    { id: "pra_dev", organizationId: ORG, projectId: OWN_PROJECT, memberEmail: "dev@example.test", teamId: null, role: "developer" },
    { id: "pra_both", organizationId: OTHER_ORG, projectId: FOREIGN_PROJECT, memberEmail: "both@example.test", teamId: null, role: "admin" },
  );
  access = new ConsoleAccessService(prisma as unknown as PrismaService);
});

describe("ConsoleAccessService.require with a project", () => {
  describe.each(ACTORS)("for %s", (_label, actor) => {
    it.each(PROJECT_ACTIONS)("refuses %s (%s) on another organization's project with 404", async (action, environmentKind) => {
      await expect(access.require(actor, ORG, action, { projectId: FOREIGN_PROJECT, environmentKind })).rejects.toMatchObject({
        status: 404,
        message: `Project '${FOREIGN_PROJECT}' was not found`,
      });
    });

    it.each(PROJECT_ACTIONS)("refuses %s (%s) on a project that does not exist with 404", async (action, environmentKind) => {
      await expect(access.require(actor, ORG, action, { projectId: MISSING_PROJECT, environmentKind })).rejects.toMatchObject({ status: 404 });
    });

    it.each(PROJECT_ACTIONS)("allows %s (%s) on the organization's own project", async (action, environmentKind) => {
      await expect(access.require(actor, ORG, action, { projectId: OWN_PROJECT, environmentKind })).resolves.toBeDefined();
    });
  });

  it("still applies the role policy inside the organization", async () => {
    const dev = member("dev@example.test");
    await expect(access.require(dev, ORG, "environment.write", { projectId: OWN_PROJECT, environmentKind: "test" })).resolves.toBeDefined();
    await expect(access.require(dev, ORG, "environment.write", { projectId: OWN_PROJECT, environmentKind: "live" })).rejects.toMatchObject({ status: 403 });
    await expect(access.require(dev, ORG, "project.manage", { projectId: OWN_PROJECT })).rejects.toMatchObject({ status: 403 });
    await expect(access.require(dev, ORG, "environment.read", { projectId: FOREIGN_PROJECT })).rejects.toMatchObject({ status: 404 });
  });

  it("answers a non-member with the organization's 404 before looking at the project", async () => {
    await expect(access.require(member("stranger@example.test"), ORG, "project.read", { projectId: OWN_PROJECT })).rejects.toMatchObject({
      status: 404,
      message: `Organization '${ORG}' was not found`,
    });
  });

  it("checks the project in the same tenant transaction as the roles, then answers repeat checks from the cache", async () => {
    await access.require(member("owner@example.test"), ORG, "project.read", { projectId: OWN_PROJECT });
    expect(prisma.tenantSettings).toEqual([ORG]);

    await access.require({ kind: "platform", id: "platform" }, ORG, "organization.read");
    await access.require({ kind: "platform", id: "platform" }, ORG, "project.read", { projectId: OWN_PROJECT });
    await access.require(member("owner@example.test"), ORG, "project.manage", { projectId: OWN_PROJECT });
    expect(prisma.tenantSettings).toEqual([ORG]);

    // A project not yet seen in this organization is looked up again.
    await expect(access.require({ kind: "platform", id: "platform" }, ORG, "project.read", { projectId: FOREIGN_PROJECT })).rejects.toMatchObject({ status: 404 });
    expect(prisma.tenantSettings).toEqual([ORG, ORG]);
  });
});

describe("control-plane routes with another organization's project", () => {
  function controller() {
    const db = prisma as unknown as PrismaService;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
    return new ControlPlaneAdminController(
      new ControlPlaneAdminService(db, audit),
      new ConsoleAccessService(db),
      new OrganizationPeopleService(db, audit),
      new QuotaService(db, audit),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  }
  const req = (actor: ConsoleActor) => ({ consoleActor: actor }) as ConsoleRequest;
  const foreign = { organizationId: ORG, projectId: FOREIGN_PROJECT };

  it.each(ACTORS)("refuses %s across organizations without touching the foreign project", async (_label, actor) => {
    const routes = controller();
    await expect(routes.getProject(foreign, req(actor))).rejects.toMatchObject({ status: 404 });
    await expect(routes.listProjectRoles(foreign, req(actor))).rejects.toMatchObject({ status: 404 });
    await expect(routes.setProjectRole(foreign, { memberEmail: "owner@example.test", role: "admin" }, req(actor))).rejects.toMatchObject({ status: 404 });
    await expect(
      routes.createProjectQuota(foreign, { environmentKind: "test", windowSeconds: 60, maxRequests: 10 }, req(actor)),
    ).rejects.toMatchObject({ status: 404 });
    await expect(routes.createApplication({ ...foreign, environment: "test" }, { slug: "x", name: "X" }, req(actor))).rejects.toMatchObject({
      status: 404,
    });
    await expect(routes.listApplications({ ...foreign, environment: "live" }, req(actor))).rejects.toMatchObject({ status: 404 });
    expect(prisma.cpProjectRoleAssignment.rows.filter((row) => row.projectId === FOREIGN_PROJECT)).toHaveLength(1);
    expect(prisma.cpQuotaPolicy.rows).toHaveLength(0);
    expect(prisma.cpApplication.rows).toHaveLength(0);
  });
});
