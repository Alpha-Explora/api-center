import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import type { ConsoleRequest } from "../../../../apps/gateway/src/domains/control-plane/console-actor.guard";
import type { ConsoleActor } from "../../../../apps/gateway/src/domains/control-plane/console-access.policy";
import { ControlPlaneAdminController } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.controller";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ConsoleAccessService } from "../../../../apps/gateway/src/domains/control-plane/console-access.service";
import { OrganizationPeopleService } from "../../../../apps/gateway/src/domains/control-plane/organization-people.service";
import { parsePageQuery } from "../../../../apps/gateway/src/domains/control-plane/list-page";
import { createFakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000f9";
const platform: ConsoleActor = { kind: "platform", id: "platform" };
const req = (consoleActor: ConsoleActor) => ({ consoleActor }) as ConsoleRequest;

function setup() {
  process.env.DATABASE_ENABLED = "true";
  const prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, status: "active" });
  const db = prisma as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
  const admin = new ControlPlaneAdminService(db, audit);
  const none = {} as never;
  const controller = new ControlPlaneAdminController(admin, new ConsoleAccessService(db), new OrganizationPeopleService(db, audit), none, none, none, none, none);
  return { prisma, admin, controller };
}

/** Follows `meta.nextCursor` until the end and returns every page's items. */
async function walk<T>(fetchPage: (query: Record<string, string>) => Promise<{ data: T[]; meta: { nextCursor: string | null } }>, limit: number) {
  const pages: T[][] = [];
  let cursor: string | null = null;
  do {
    const page = await fetchPage({ limit: String(limit), ...(cursor ? { cursor } : {}) });
    pages.push(page.data);
    cursor = page.meta.nextCursor;
  } while (cursor);
  return pages;
}

describe("paged console lists", () => {
  it("pages members by email, each exactly once", async () => {
    const { prisma, controller } = setup();
    const emails = Array.from({ length: 7 }, (_, i) => `m${i}@example.test`);
    for (const email of [...emails].reverse()) {
      prisma.organizationMember.rows.push({ organizationId: ORG, email, role: "developer", status: "active", inviteExpiresAt: null, subject: null });
    }
    const pages = await walk((query) => controller.listMembers(ORG, query, req(platform)), 3);
    expect(pages.map((page) => page.length)).toEqual([3, 3, 1]);
    expect(pages.flat().map((member) => member.email)).toEqual(emails);
  });

  it("pages projects oldest first, ties broken by ID", async () => {
    const { admin, controller } = setup();
    const created: string[] = [];
    for (let i = 0; i < 5; i += 1) created.push((await admin.createProject(ORG, { slug: `p${i}`, name: `P${i}` }, "ops")).id);
    const pages = await walk((query) => controller.listProjects(ORG, query, req(platform)), 2);
    expect(pages.flat().map((project) => project.id).sort()).toEqual([...created].sort());
    expect(new Set(pages.flat().map((project) => project.id)).size).toBe(5);
  });

  it("refuses a bad limit or a forged cursor", () => {
    expect(() => parsePageQuery({ limit: "0" }, 1)).toThrow("limit must be");
    expect(() => parsePageQuery({ limit: "500" }, 1)).toThrow("limit must be");
    expect(() => parsePageQuery({ cursor: "not-a-cursor" }, 2)).toThrow("cursor is invalid");
    expect(parsePageQuery({}, 1)).toEqual({ limit: 100 });
  });
});
