import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import type { ConsoleRequest } from "../../../../apps/gateway/src/domains/control-plane/console-actor.guard";
import type { ConsoleActor } from "../../../../apps/gateway/src/domains/control-plane/console-access.policy";
import type { MemberInviteService } from "../../../../apps/gateway/src/domains/control-plane/member-invite.service";
import { OrganizationAdminController } from "../../../../apps/gateway/src/domains/control-plane/organization-admin.controller";
import { OrganizationAdminService } from "../../../../apps/gateway/src/domains/control-plane/organization-admin.service";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";
import { ConsoleAccessService } from "../../../../apps/gateway/src/domains/control-plane/console-access.service";

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
  process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/apicenter_test";
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

describe("renaming an organization", () => {
  function withAccess() {
    const db = prisma as unknown as PrismaService;
    const service = new OrganizationAdminService(db, audit as unknown as AuditEventsService);
    return new OrganizationAdminController(service, { invite } as unknown as MemberInviteService, new ConsoleAccessService(db));
  }

  it("lets an owner change the name but not the slug", async () => {
    const owned = withAccess();
    await expect(owned.rename(ORG, { name: "Serbizio PH" }, req(owner))).resolves.toMatchObject({ data: { name: "Serbizio PH", slug: "serbizio" } });
    await expect(owned.rename(ORG, { slug: "serbizio-ph" }, req(owner))).rejects.toMatchObject({ status: 403 });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: "control_plane.organization.renamed" }));
  });

  it("refuses members who are not owners", async () => {
    const dev: ConsoleActor = { kind: "member", email: "dev@example.test", subject: "s-dev", platformAdmin: false };
    await expect(withAccess().rename(ORG, { name: "Mine" }, req(dev))).rejects.toMatchObject({ status: 403 });
  });

  it("lets platform operators change the slug too", async () => {
    await expect(withAccess().rename(ORG, { slug: "serbizio-ph" }, req(platform))).resolves.toMatchObject({ data: { slug: "serbizio-ph" } });
  });
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
    // Attributed, so the new organization's own audit log shows them.
    expect(audit.record.mock.calls.map(([event]) => event.organizationId)).toEqual([data.id, data.id]);
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

  it("refuses names with control characters, which would break every invite's subject", async () => {
    await expect(controller.create({ name: "Acme\nBcc: x@y.test", slug: "acme" }, req(operator))).rejects.toMatchObject({ status: 400 });
    await expect(controller.create({ name: "Acme\u0007", slug: "acme" }, req(operator))).rejects.toMatchObject({ status: 400 });
    await expect(controller.rename(ORG, { name: "Serbizio\r\nPH" }, req(operator))).rejects.toMatchObject({ status: 400 });
    await expect(controller.create({ name: "  Acme Inc.  ", slug: "acme" }, req(operator))).resolves.toMatchObject({ data: { name: "Acme Inc." } });
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
    expect(audit.record.mock.calls.map(([event]) => [event.type, event.severity, event.organizationId])).toEqual([
      ["control_plane.organization.suspended", "warning", ORG],
      ["control_plane.organization.reactivated", "info", ORG],
    ]);
  });

  it("leaves archived organizations alone and 404s unknown ones", async () => {
    prisma.organization.rows[0].status = "archived";
    await expect(controller.setStatus(ORG, { status: "active" }, req(operator))).rejects.toMatchObject({ code: "ORGANIZATION_STATUS_FIXED" });
    await expect(controller.setStatus("6f1c1d1e-0000-4000-8000-0000000000ff", { status: "active" }, req(operator))).rejects.toMatchObject({ status: 404 });
  });
});
