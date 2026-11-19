import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import type { ConsoleRequest } from "../../../../apps/gateway/src/domains/control-plane/console-actor.guard";
import type { ConsoleActor } from "../../../../apps/gateway/src/domains/control-plane/console-access.policy";
import type { MemberInviteService } from "../../../../apps/gateway/src/domains/control-plane/member-invite.service";
import { OrganizationAdminController } from "../../../../apps/gateway/src/domains/control-plane/organization-admin.controller";
import { OrganizationAdminService } from "../../../../apps/gateway/src/domains/control-plane/organization-admin.service";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000a1";
const platform: ConsoleActor = { kind: "platform", id: "platform" };
const operator: ConsoleActor = { kind: "member", email: "ops@example.test", subject: "s-ops", platformAdmin: true };
const owner: ConsoleActor = { kind: "member", email: "owner@example.test", subject: "s-owner", platformAdmin: false };
const req = (actor: ConsoleActor) => ({ consoleActor: actor }) as ConsoleRequest;

let prisma: FakeControlPlanePrisma;
let audit: { record: jest.Mock };
let invite: jest.Mock;
let controller: OrganizationAdminController;

beforeAll(() => {
  process.env.DATABASE_ENABLED = "true";
});

beforeEach(() => {
  prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, slug: "serbizio", name: "Serbizio", status: "active", createdAt: new Date("2026-11-01") });
  prisma.organizationMember.rows.push(
    { organizationId: ORG, email: "owner@example.test", role: "owner", status: "active" },
    { organizationId: ORG, email: "dev@example.test", role: "developer", status: "active" },
  );
  prisma.cpProject.rows.push({ id: "prj_a", organizationId: ORG, slug: "a", name: "A" });
  audit = { record: jest.fn().mockResolvedValue(undefined) };
  invite = jest.fn().mockResolvedValue({ status: "sent", consoleUrl: "https://console.test", text: "invite" });
  const service = new OrganizationAdminService(prisma as unknown as PrismaService, audit as unknown as AuditEventsService);
  controller = new OrganizationAdminController(service, { invite } as unknown as MemberInviteService);
});

describe("organization administration", () => {
  it("is for platform operators only", async () => {
    await expect(controller.list(req(owner))).rejects.toMatchObject({ status: 403 });
    await expect(controller.create({ name: "X", slug: "x" }, req(owner))).rejects.toMatchObject({ status: 403 });
    await expect(controller.setStatus(ORG, { status: "suspended" }, req(owner))).rejects.toMatchObject({ status: 403 });
    await expect(controller.list(req(platform))).resolves.toMatchObject({ success: true });
  });

  it("lists organizations with project and member counts, using the platform tenant scope", async () => {
    const { data } = await controller.list(req(operator));
    expect(data).toEqual([expect.objectContaining({ id: ORG, name: "Serbizio", status: "active", projectCount: 1, memberCount: 2 })]);
    expect(prisma.tenantSettings).toContain("platform");
  });

  it("creates an organization with its first owner, invites them and audits both writes", async () => {
    const { data } = await controller.create({ name: "Alpha CI", slug: "alpha-ci", ownerEmail: " Lead@Example.test " }, req(operator));
    expect(data).toMatchObject({ name: "Alpha CI", slug: "alpha-ci", status: "active", owner: { email: "lead@example.test", role: "owner", invite: { status: "sent" } } });
    expect(prisma.organizationMember.rows).toContainEqual(
      expect.objectContaining({ organizationId: data.id, email: "lead@example.test", role: "owner", createdBy: "ops@example.test" }),
    );
    expect(invite).toHaveBeenCalledWith({ organizationId: data.id, email: "lead@example.test", role: "owner", invitedBy: "ops@example.test" });
    expect(audit.record.mock.calls.map(([event]) => event.type)).toEqual(["control_plane.organization.created", "control_plane.member.set"]);
  });

  it("creates an organization without an owner and sends no invite", async () => {
    const { data } = await controller.create({ name: "Solo", slug: "solo" }, req(platform));
    expect(data.owner).toBeNull();
    expect(invite).not.toHaveBeenCalled();
  });

  it("validates slugs like project slugs and refuses a duplicate with 409", async () => {
    await expect(controller.create({ name: "Bad", slug: "Bad Slug" }, req(operator))).rejects.toMatchObject({ status: 400 });
    await expect(controller.create({ name: "Dup", slug: "serbizio" }, req(operator))).rejects.toMatchObject({ status: 409 });
    await expect(controller.create({ name: "X", slug: "x", extra: true }, req(operator))).rejects.toMatchObject({ status: 400 });
  });

  it("renames an organization and refuses a slug another one uses", async () => {
    await controller.create({ name: "Other", slug: "other" }, req(operator));
    await expect(controller.rename(ORG, { slug: "other" }, req(operator))).rejects.toMatchObject({ status: 409 });
    await expect(controller.rename(ORG, {}, req(operator))).rejects.toMatchObject({ status: 400 });
    const { data } = await controller.rename(ORG, { name: "Serbizio PH", slug: "serbizio-ph" }, req(operator));
    expect(data).toMatchObject({ name: "Serbizio PH", slug: "serbizio-ph" });
    expect(audit.record).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "control_plane.organization.renamed",
        payload: { before: { name: "Serbizio", slug: "serbizio" }, after: { name: "Serbizio PH", slug: "serbizio-ph" } },
      }),
    );
  });

  it("suspends and reactivates, recording each change once", async () => {
    await expect(controller.setStatus(ORG, { status: "archived" }, req(operator))).rejects.toMatchObject({ status: 400 });
    expect((await controller.setStatus(ORG, { status: "suspended" }, req(operator))).data.status).toBe("suspended");
    await controller.setStatus(ORG, { status: "suspended" }, req(operator));
    expect((await controller.setStatus(ORG, { status: "active" }, req(operator))).data.status).toBe("active");
    expect(audit.record.mock.calls.map(([event]) => [event.type, event.severity])).toEqual([
      ["control_plane.organization.suspended", "warning"],
      ["control_plane.organization.reactivated", "info"],
    ]);
  });

  it("leaves archived organizations alone and 404s unknown ones", async () => {
    prisma.organization.rows[0].status = "archived";
    await expect(controller.setStatus(ORG, { status: "active" }, req(operator))).rejects.toMatchObject({ code: "ORGANIZATION_STATUS_FIXED" });
    await expect(controller.setStatus("6f1c1d1e-0000-4000-8000-0000000000ff", { status: "active" }, req(operator))).rejects.toMatchObject({ status: 404 });
  });
});
