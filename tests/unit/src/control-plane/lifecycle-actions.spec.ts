import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ApplicationAccessService } from "../../../../apps/gateway/src/domains/control-plane/application-access.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { OrganizationPeopleService } from "../../../../apps/gateway/src/domains/control-plane/organization-people.service";
import { QuotaService } from "../../../../apps/gateway/src/domains/control-plane/quota.service";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000f7";
const actor = "admin@example.test";

let prisma: FakeControlPlanePrisma;
let admin: ControlPlaneAdminService;
let people: OrganizationPeopleService;
let access: ApplicationAccessService;
const { privateKey } = generateKeyPairSync("ed25519");

beforeEach(() => {
  process.env.DATABASE_ENABLED = "true";
  prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, status: "active" });
  const db = prisma as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
  admin = new ControlPlaneAdminService(db, audit);
  people = new OrganizationPeopleService(db, audit);
  access = new ApplicationAccessService(
    db,
    new RuntimeContextSigner({ APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k" }) }),
    new QuotaService(db, audit),
  );
});

async function emailKey() {
  const project = await admin.createProject(ORG, { slug: "shop", name: "Shop" }, actor);
  const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
  await admin.setCapability(scope, "email", true, actor);
  const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
  await admin.grant(scope, app.id, { capability: "email", action: "email:send" }, actor);
  const { secret } = await admin.issueCredential(scope, app.id, { operationId: randomUUID() }, actor);
  const send = () => access.authorize({ bearer: secret, capability: "email", method: "POST", relativePath: "/send", requestId: randomUUID() });
  return { project, scope, app, send };
}

describe("application suspension", () => {
  it("refuses a suspended application's keys until it is resumed", async () => {
    const { scope, app, send } = await emailKey();
    await admin.setApplicationStatus(scope, app.id, "suspended", actor);
    await expect(send()).rejects.toMatchObject({ status: 403, code: "APPLICATION_INACTIVE" });
    await expect(admin.issueCredential(scope, app.id, { operationId: randomUUID() }, actor)).rejects.toMatchObject({ code: "APPLICATION_INACTIVE" });
    await admin.setApplicationStatus(scope, app.id, "active", actor);
    await expect(send()).resolves.toBeDefined();
  });

  it("changes an application only through its own environment", async () => {
    const { project, app } = await emailKey();
    const live = { organizationId: ORG, projectId: project.id, environmentKind: "live" as const };
    await expect(admin.setApplicationStatus(live, app.id, "suspended", actor)).rejects.toMatchObject({ status: 404 });
  });
});

describe("project archiving", () => {
  it("refuses an archived project's requests and keeps everything for a restore", async () => {
    const { project, send } = await emailKey();
    await admin.setProjectStatus(ORG, project.id, "archived", actor);
    await expect(send()).rejects.toMatchObject({ code: "PROJECT_INACTIVE" });
    await admin.setProjectStatus(ORG, project.id, "active", actor);
    await expect(send()).resolves.toBeDefined();
  });

  it("leaves a project an operator suspended to the operator", async () => {
    const { project } = await emailKey();
    prisma.cpProject.rows.find((row) => row.id === project.id)!.status = "suspended";
    await expect(admin.setProjectStatus(ORG, project.id, "active", actor)).rejects.toMatchObject({ code: "SUSPENDED_BY_PLATFORM" });
  });
});

describe("team deletion", () => {
  beforeEach(() => {
    // Nobody is an organization owner or admin, so project admins come only from assignments.
    for (const email of ["dev@example.test", "dev2@example.test"]) {
      prisma.organizationMember.rows.push({ organizationId: ORG, email, role: "developer", status: "active", subject: null });
    }
  });

  it("deletes a team with its memberships and roles, unless it is a project's only administrator", async () => {
    const project = await admin.createProject(ORG, { slug: "guarded", name: "Guarded" }, actor);
    const team = await people.createTeam(ORG, { slug: "ops", name: "Ops" }, actor);
    await people.addTeamMember(ORG, team.id, "dev@example.test", actor);
    await people.setProjectRole(ORG, project.id, { teamId: team.id }, "admin", actor);

    await expect(people.deleteTeam(ORG, team.id, actor)).rejects.toMatchObject({ code: "LAST_PROJECT_ADMIN" });

    await people.setProjectRole(ORG, project.id, { memberEmail: "dev2@example.test" }, "admin", actor);
    await expect(people.deleteTeam(ORG, team.id, actor)).resolves.toEqual({ id: team.id, deleted: true });
    expect(prisma.cpTeam.rows.some((row) => row.id === team.id)).toBe(false);
    expect(prisma.cpTeamMember.rows.some((row) => row.teamId === team.id)).toBe(false);
    expect(prisma.cpProjectRoleAssignment.rows.some((row) => row.teamId === team.id)).toBe(false);
    await expect(people.deleteTeam(ORG, team.id, actor)).rejects.toMatchObject({ status: 404 });
  });
});
