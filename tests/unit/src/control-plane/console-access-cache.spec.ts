import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ACCESS_TTL_MS, ConsoleAccessCache } from "../../../../apps/gateway/src/domains/control-plane/console-access-cache";
import { ConsoleAccessService } from "../../../../apps/gateway/src/domains/control-plane/console-access.service";
import { OrganizationPeopleService } from "../../../../apps/gateway/src/domains/control-plane/organization-people.service";
import type { ConsoleActor, MemberAccess } from "../../../../apps/gateway/src/domains/control-plane/console-access.policy";
import { createFakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000e1";
const OTHER_ORG = "6f1c1d1e-0000-4000-8000-0000000000e2";
const admin = { kind: "member", email: "admin@example.test", subject: "sub-admin", platformAdmin: false } as const satisfies ConsoleActor;
const dev = { kind: "member", email: "dev@example.test", subject: "sub-dev", platformAdmin: false } as const satisfies ConsoleActor;
const platform: ConsoleActor = { kind: "platform", id: "platform" };

describe("ConsoleAccessCache", () => {
  const value: MemberAccess = { organizationRole: "admin", projectRoles: new Map() };

  it("forgets access after the TTL and when the organization's people change", () => {
    const cache = new ConsoleAccessCache();
    cache.setAccess(ORG, "a@x.test", "s", value, 0);
    cache.setAccess(OTHER_ORG, "a@x.test", "s", value, 0);
    expect(cache.getAccess(ORG, "a@x.test", "s", ACCESS_TTL_MS - 1)).toBe(value);
    expect(cache.getAccess(ORG, "a@x.test", "other-subject", 0)).toBeUndefined();
    expect(cache.getAccess(ORG, "a@x.test", "s", ACCESS_TTL_MS)).toBeUndefined();

    cache.setAccess(ORG, "a@x.test", "s", value, 0);
    cache.invalidateOrganization(ORG);
    expect(cache.getAccess(ORG, "a@x.test", "s", 0)).toBeUndefined();
    expect(cache.getAccess(OTHER_ORG, "a@x.test", "s", 0)).toBe(value);
  });

  it("remembers only the organization a project was found in", () => {
    const cache = new ConsoleAccessCache();
    cache.rememberProject("prj_1", ORG);
    expect(cache.projectBelongsTo("prj_1", ORG)).toBe(true);
    expect(cache.projectBelongsTo("prj_1", OTHER_ORG)).toBe(false);
  });
});

describe("cached console access", () => {
  function setup() {
    process.env.DATABASE_ENABLED = "true";
    const prisma = createFakeControlPlanePrisma();
    prisma.organization.rows.push({ id: ORG, status: "active" }, { id: OTHER_ORG, status: "active" });
    prisma.organizationMember.rows.push(
      { organizationId: ORG, email: admin.email, role: "admin", status: "active", subject: null },
      { organizationId: ORG, email: dev.email, role: "operator", status: "active", subject: null },
    );
    prisma.cpProject.rows.push({ id: "prj_1", organizationId: ORG, slug: "shop", name: "Shop", status: "active" });
    const db = prisma as unknown as PrismaService;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
    const transactions = jest.spyOn(prisma, "$transaction");
    return { access: new ConsoleAccessService(db), people: new OrganizationPeopleService(db, audit), transactions };
  }

  it("checks a page's worth of requests with one database transaction", async () => {
    const { access, transactions } = setup();
    for (let i = 0; i < 12; i += 1) await access.require(admin, ORG, "project.read", { projectId: "prj_1" });
    expect(transactions).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 12; i += 1) await access.require(platform, ORG, "project.read", { projectId: "prj_1" });
    expect(transactions).toHaveBeenCalledTimes(1);
  });

  it("never caches a project under the wrong organization", async () => {
    const { access } = setup();
    await access.require(platform, ORG, "project.read", { projectId: "prj_1" });
    await expect(access.require(platform, OTHER_ORG, "project.read", { projectId: "prj_1" })).rejects.toMatchObject({ status: 404 });
  });

  it("applies a role change on this instance immediately", async () => {
    const { access, people } = setup();
    await access.require(dev, ORG, "organization.read");
    await expect(access.require(dev, ORG, "organization.members.manage")).rejects.toMatchObject({ status: 403 });

    await people.setMember(ORG, dev.email, "admin", admin.email);
    await expect(access.require(dev, ORG, "organization.members.manage")).resolves.toBeDefined();

    await people.removeMember(ORG, dev.email, admin.email);
    await expect(access.require(dev, ORG, "organization.read")).rejects.toMatchObject({ status: 404 });
  });
});
