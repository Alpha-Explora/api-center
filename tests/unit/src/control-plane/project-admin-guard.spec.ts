import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { OrganizationPeopleService } from "../../../../apps/gateway/src/domains/control-plane/organization-people.service";
import { hasProjectAdministrator } from "../../../../apps/gateway/src/domains/control-plane/project-admin-guard";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000f1";
const PROJECT = "prj_guarded0000000000000001";
const actor = "ops@example.test";

describe("hasProjectAdministrator", () => {
  const members = new Set(["a@example.test", "b@example.test"]);
  const none = new Map<string, string[]>();

  it("is satisfied by any organization owner or admin", () => {
    expect(hasProjectAdministrator({ organizationAdmins: 1, adminAssignments: [], activeMembers: members, teamMembers: none })).toBe(true);
  });

  it("counts a direct admin only while they are an active member", () => {
    const direct = [{ memberEmail: "a@example.test", teamId: null }];
    expect(hasProjectAdministrator({ organizationAdmins: 0, adminAssignments: direct, activeMembers: members, teamMembers: none })).toBe(true);
    expect(hasProjectAdministrator({ organizationAdmins: 0, adminAssignments: direct, activeMembers: new Set(), teamMembers: none })).toBe(false);
  });

  it("counts an admin team only when one of its people is an active member", () => {
    const team = [{ memberEmail: null, teamId: "tm_1" }];
    expect(
      hasProjectAdministrator({ organizationAdmins: 0, adminAssignments: team, activeMembers: members, teamMembers: new Map([["tm_1", ["b@example.test"]]]) }),
    ).toBe(true);
    expect(hasProjectAdministrator({ organizationAdmins: 0, adminAssignments: team, activeMembers: members, teamMembers: new Map([["tm_1", []]]) })).toBe(false);
    expect(
      hasProjectAdministrator({ organizationAdmins: 0, adminAssignments: team, activeMembers: members, teamMembers: new Map([["tm_1", ["gone@example.test"]]]) }),
    ).toBe(false);
  });

  it("is not satisfied by nothing", () => {
    expect(hasProjectAdministrator({ organizationAdmins: 0, adminAssignments: [], activeMembers: members, teamMembers: none })).toBe(false);
  });
});

describe("project role changes keep an administrator", () => {
  let prisma: FakeControlPlanePrisma;
  let people: OrganizationPeopleService;

  beforeAll(() => {
    process.env.DATABASE_ENABLED = "true";
  });

  beforeEach(() => {
    prisma = createFakeControlPlanePrisma();
    prisma.organization.rows.push({ id: ORG, status: "active" });
    prisma.cpProject.rows.push({ id: PROJECT, organizationId: ORG, slug: "guarded", name: "Guarded", status: "active" });
    // A legacy organization: nobody is an owner or admin, so only explicit project admins administer.
    for (const email of ["dev@example.test", "dev2@example.test"]) {
      prisma.organizationMember.rows.push({ organizationId: ORG, email, role: "operator", status: "active", subject: null });
    }
    people = new OrganizationPeopleService(prisma as unknown as PrismaService, { record: jest.fn() } as unknown as AuditEventsService);
  });

  const assign = (assignee: { memberEmail: string } | { teamId: string }, role: "admin" | "developer" | "viewer") =>
    people.setProjectRole(ORG, PROJECT, assignee, role, actor);

  it("refuses to remove or demote the last explicit admin when no organization owner or admin remains", async () => {
    const only = await assign({ memberEmail: "dev@example.test" }, "admin");
    await expect(people.removeProjectRole(ORG, PROJECT, only.id, actor)).rejects.toMatchObject({ status: 409, code: "LAST_PROJECT_ADMIN" });
    await expect(assign({ memberEmail: "dev@example.test" }, "developer")).rejects.toMatchObject({ code: "LAST_PROJECT_ADMIN" });
    expect(prisma.cpProjectRoleAssignment.rows).toMatchObject([{ id: only.id, role: "admin" }]);
  });

  it("allows it once another person administers the project", async () => {
    const first = await assign({ memberEmail: "dev@example.test" }, "admin");
    await assign({ memberEmail: "dev2@example.test" }, "admin");
    await expect(assign({ memberEmail: "dev@example.test" }, "viewer")).resolves.toMatchObject({ role: "viewer" });
    await expect(people.removeProjectRole(ORG, PROJECT, first.id, actor)).resolves.toMatchObject({ removed: true });
  });

  it("counts an admin team with an active member, but not an empty one", async () => {
    const only = await assign({ memberEmail: "dev@example.test" }, "admin");
    prisma.cpTeam.rows.push({ id: "tm_empty", organizationId: ORG, slug: "empty", name: "Empty" }, { id: "tm_ops", organizationId: ORG, slug: "ops", name: "Ops" });
    await assign({ teamId: "tm_empty" }, "admin");
    await expect(people.removeProjectRole(ORG, PROJECT, only.id, actor)).rejects.toMatchObject({ code: "LAST_PROJECT_ADMIN" });

    prisma.cpTeamMember.rows.push({ organizationId: ORG, teamId: "tm_ops", email: "dev2@example.test" });
    await assign({ teamId: "tm_ops" }, "admin");
    await expect(people.removeProjectRole(ORG, PROJECT, only.id, actor)).resolves.toMatchObject({ removed: true });
  });

  it("does not count an assignment left behind by someone who is no longer a member", async () => {
    const stale = await assign({ memberEmail: "dev2@example.test" }, "admin");
    const only = await assign({ memberEmail: "dev@example.test" }, "admin");
    prisma.organizationMember.rows.splice(prisma.organizationMember.rows.findIndex((row) => row.email === "dev2@example.test"), 1);
    await expect(people.removeProjectRole(ORG, PROJECT, only.id, actor)).rejects.toMatchObject({ code: "LAST_PROJECT_ADMIN" });
    await expect(people.removeProjectRole(ORG, PROJECT, stale.id, actor)).resolves.toMatchObject({ removed: true });
  });

  it("leaves non-admin assignments and organizations with an owner or admin alone", async () => {
    const viewer = await assign({ memberEmail: "dev2@example.test" }, "viewer");
    await expect(people.removeProjectRole(ORG, PROJECT, viewer.id, actor)).resolves.toMatchObject({ removed: true });

    const only = await assign({ memberEmail: "dev@example.test" }, "admin");
    prisma.organizationMember.rows.push({ organizationId: ORG, email: "boss@example.test", role: "admin", status: "active", subject: null });
    await expect(people.removeProjectRole(ORG, PROJECT, only.id, actor)).resolves.toMatchObject({ removed: true });
  });

  it("does not count an owner whose membership is not active", async () => {
    prisma.organizationMember.rows.push({ organizationId: ORG, email: "invited@example.test", role: "owner", status: "invited", subject: null });
    const only = await assign({ memberEmail: "dev@example.test" }, "admin");
    await expect(people.removeProjectRole(ORG, PROJECT, only.id, actor)).rejects.toMatchObject({ code: "LAST_PROJECT_ADMIN" });
  });
});
