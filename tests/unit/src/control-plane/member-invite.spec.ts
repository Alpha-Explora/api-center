import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import type { ConsoleRequest } from "../../../../apps/gateway/src/domains/control-plane/console-actor.guard";
import type { ConsoleActor } from "../../../../apps/gateway/src/domains/control-plane/console-access.policy";
import { ControlPlaneAdminController } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.controller";
import { ConsoleAccessService } from "../../../../apps/gateway/src/domains/control-plane/console-access.service";
import { OrganizationPeopleService } from "../../../../apps/gateway/src/domains/control-plane/organization-people.service";
import { MemberInviteService } from "../../../../apps/gateway/src/domains/control-plane/member-invite.service";
import { consoleUrlFrom, inviteLink, inviteMessage, DEFAULT_CONSOLE_URL } from "../../../../apps/gateway/src/domains/control-plane/member-invite";
import { consoleAccessCacheFor } from "../../../../apps/gateway/src/domains/control-plane/console-access-cache";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000d1";
const ENV_KEYS = ["EMAIL_ADMIN_TOKEN", "SHARED_SERVICE_ROUTE_EMAIL_LIVE", "MANAGEMENT_CONSOLE_URL", "CLOUD_RUN_AUTH_ENABLED"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

let prisma: FakeControlPlanePrisma;
let audit: { record: jest.Mock; hasEventSince: jest.Mock };
let invites: MemberInviteService;
let fetchMock: jest.Mock;

function respond(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

beforeAll(() => {
  process.env.DATABASE_ENABLED = "true";
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.EMAIL_ADMIN_TOKEN = "email-admin";
  process.env.SHARED_SERVICE_ROUTE_EMAIL_LIVE = "http://email.internal/";
  prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, name: "Serbizio", slug: "serbizio", status: "active" });
  prisma.organizationMember.rows.push({ organizationId: ORG, email: "owner@example.test", role: "owner", status: "active", subject: null });
  audit = {
    record: jest.fn().mockResolvedValue(undefined),
    // Answers from the fake audit table, as AuditEventsService.hasEventSince does from the real one.
    hasEventSince: jest.fn(async (query: { action: string; resourceType: string; resourceId: string; since: Date }) =>
      prisma.auditEvent.rows.some(
        (row) =>
          row.action === query.action &&
          row.resourceType === query.resourceType &&
          row.resourceId === query.resourceId &&
          (row.createdAt as Date) >= query.since,
      ),
    ),
  };
  invites = new MemberInviteService(prisma as unknown as PrismaService, audit as unknown as AuditEventsService);
  fetchMock = jest.fn().mockResolvedValue(respond(201, { success: true, data: { messageId: "msg_1", status: "queued", provider: "resend" } }));
  invites.useFetch(fetchMock);
});

describe("invite message", () => {
  it("names who invited, the organization, the role and what it allows, and the account to sign in with", () => {
    const message = inviteMessage({
      organizationName: "Alpha Explora",
      email: "jun@serbizio.ph",
      role: "developer",
      consoleUrl: "https://console.test",
      invitedBy: "maria@serbizio.ph",
      invitedByName: "Maria Santos",
      expiresAt: new Date("2026-11-27T18:52:51Z"),
      projects: [{ name: "Serbizio", role: "admin" }],
    });
    expect(message.subject).toBe("Maria Santos invited you to Alpha Explora on APICenter");
    expect(message.text).toContain("Maria Santos (maria@serbizio.ph) invited you to join Alpha Explora on APICenter as a developer.");
    expect(message.text).toContain("You'll have admin access to Serbizio.");
    expect(message.text).toContain("As a developer you can create projects");
    expect(message.text).toContain("Sign in with Google as jun@serbizio.ph.");
    expect(message.text).toContain("This invite expires on 27 November 2026. If it does, ask Maria Santos to send it again.");
    expect(message.text).toContain(`Accept the invite: ${inviteLink("https://console.test", "jun@serbizio.ph")}`);
    expect(message.html).toContain('href="https://console.test/signup?login_hint=jun%40serbizio.ph"');
    expect(message.html).toContain(">Accept invite</a>");
  });

  it("lists several projects in one sentence", () => {
    const message = inviteMessage({
      organizationName: "Alpha Explora",
      email: "a@b.test",
      role: "viewer",
      consoleUrl: "https://c.test",
      projects: [
        { name: "Serbizio", role: "admin" },
        { name: "AlphaCI", role: "developer" },
        { name: "Smoke", role: "viewer" },
      ],
    });
    expect(message.text).toContain("You'll have admin access to Serbizio, developer access to AlphaCI and viewer access to Smoke.");
  });

  it("does not name a platform caller as the inviter and escapes HTML", () => {
    const message = inviteMessage({ organizationName: "<b>Acme</b>", email: "a@b.test", role: "viewer", consoleUrl: "https://c.test", invitedBy: "platform:ops", invitedByName: "Ops" });
    expect(message.subject).toBe("You're invited to <b>Acme</b> on APICenter");
    expect(message.text.startsWith("You've been invited to join <b>Acme</b>")).toBe(true);
    expect(message.text).not.toContain("Ops");
    expect(message.html).toContain("&lt;b&gt;Acme&lt;/b&gt;");
    expect(message.html).not.toContain("<b>Acme</b>");
  });

  it("keeps a Google name to one line in the subject", () => {
    const message = inviteMessage({ organizationName: "Acme", email: "a@b.test", role: "viewer", consoleUrl: "https://c.test", invitedBy: "m@b.test", invitedByName: "Maria\r\nBcc: x@y.test" });
    expect(message.subject).toBe("Maria Bcc: x@y.test invited you to Acme on APICenter");
    expect(message.subject).not.toMatch(/[\r\n]/);
  });

  it("uses MANAGEMENT_CONSOLE_URL only when it is an absolute http(s) URL", () => {
    expect(consoleUrlFrom(undefined)).toBe(DEFAULT_CONSOLE_URL);
    expect(consoleUrlFrom("https://console.example.test/")).toBe("https://console.example.test");
    expect(consoleUrlFrom("javascript:alert(1)")).toBe(DEFAULT_CONSOLE_URL);
    expect(consoleUrlFrom("not a url")).toBe(DEFAULT_CONSOLE_URL);
  });
});

describe("MemberInviteService", () => {
  const input = { organizationId: ORG, email: "jun@serbizio.ph", role: "developer", invitedBy: "owner@example.test" };

  it("sends through the email runtime's admin route and records it", async () => {
    process.env.MANAGEMENT_CONSOLE_URL = "https://console.example.test";
    const outcome = await invites.invite(input);
    expect(outcome).toMatchObject({ status: "sent", consoleUrl: "https://console.example.test" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://email.internal/admin/platform-messages");
    expect(init.headers).toMatchObject({ "X-APICenter-Email-Admin-Token": "email-admin" });
    expect(JSON.parse(init.body)).toMatchObject({
      to: "jun@serbizio.ph",
      subject: "owner@example.test invited you to Serbizio on APICenter",
      fromName: "APICenter",
      replyTo: "owner@example.test",
    });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: "control_plane.member.invite_sent", organizationId: ORG, resourceId: `${ORG}:jun@serbizio.ph` }));
  });

  it("says when the invite expires and which projects the member gets, as stored now", async () => {
    const expiresAt = new Date("2026-11-27T18:52:51Z");
    prisma.organizationMember.rows.push({ organizationId: ORG, email: "jun@serbizio.ph", role: "developer", status: "invited", inviteExpiresAt: expiresAt, subject: null });
    prisma.cpProject.rows.push({ id: "prj_ssssssssssssssssssssssss", organizationId: ORG, slug: "serbizio", name: "Serbizio", status: "active" });
    prisma.cpProjectRoleAssignment.rows.push({ id: "pra_1", organizationId: ORG, projectId: "prj_ssssssssssssssssssssssss", memberEmail: "jun@serbizio.ph", teamId: null, role: "admin" });

    await invites.invite({ ...input, invitedByName: "Owner Person" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.subject).toBe("Owner Person invited you to Serbizio on APICenter");
    expect(body.text).toContain("You'll have admin access to Serbizio.");
    expect(body.text).toContain("This invite expires on 27 November 2026.");
  });

  it("sends no reply-to for a platform caller", async () => {
    await invites.invite({ ...input, invitedBy: "platform:ops" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty("replyTo");
  });

  it("reports, records and carries on when email is not configured", async () => {
    delete process.env.EMAIL_ADMIN_TOKEN;
    const outcome = await invites.invite(input);
    expect(outcome).toMatchObject({ status: "not_sent", reason: "EMAIL_NOT_CONFIGURED", consoleUrl: DEFAULT_CONSOLE_URL });
    expect(outcome.text).toContain(DEFAULT_CONSOLE_URL);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: "control_plane.member.invite_not_sent", severity: "warning" }));

    process.env.EMAIL_ADMIN_TOKEN = "email-admin";
    delete process.env.SHARED_SERVICE_ROUTE_EMAIL_LIVE;
    expect(await invites.invite(input)).toMatchObject({ reason: "EMAIL_NOT_CONFIGURED" });
  });

  it("never throws: unreachable, refusing or provider-less runtimes become not_sent", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect(await invites.invite(input)).toMatchObject({ status: "not_sent", reason: "EMAIL_UNAVAILABLE" });
    fetchMock.mockResolvedValueOnce(respond(429, { error: "DAILY_LIMIT_REACHED" }));
    expect(await invites.invite(input)).toMatchObject({ reason: "EMAIL_REJECTED", detail: "The email runtime returned 429 DAILY_LIMIT_REACHED" });
    fetchMock.mockResolvedValueOnce(respond(201, { success: true, data: { provider: "mock" } }));
    expect(await invites.invite(input)).toMatchObject({ reason: "EMAIL_PROVIDER_NOT_CONFIGURED" });
    audit.record.mockRejectedValueOnce(new Error("audit down"));
    await expect(invites.invite(input)).resolves.toMatchObject({ status: "sent" });
  });

  it("sends one invite per organization and email a day, so add-remove-add cannot spend the allowance", async () => {
    expect(await invites.invite(input)).toMatchObject({ status: "sent" });
    expect(await invites.invite(input)).toMatchObject({ status: "not_sent", reason: "RECENTLY_INVITED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenLastCalledWith(expect.objectContaining({ type: "control_plane.member.invite_not_sent", payload: expect.objectContaining({ reason: "RECENTLY_INVITED" }) }));
    // Another organization, or another person, is a different invite.
    prisma.organization.rows.push({ id: "6f1c1d1e-0000-4000-8000-0000000000d2", name: "Other", slug: "other", status: "active" });
    expect(await invites.invite({ ...input, organizationId: "6f1c1d1e-0000-4000-8000-0000000000d2" })).toMatchObject({ status: "sent" });
    expect(await invites.invite({ ...input, email: "ana@serbizio.ph" })).toMatchObject({ status: "sent" });
  });

  it("reads earlier invites from the audit log, so another gateway instance also skips them", async () => {
    prisma.auditEvent.rows.push(
      { id: "a1", action: "control_plane.member.invite_sent", resourceType: "member", resourceId: `${ORG}:jun@serbizio.ph`, createdAt: new Date(Date.now() - 60 * 60 * 1000) },
      { id: "a2", action: "control_plane.member.invite_sent", resourceType: "member", resourceId: `${ORG}:old@serbizio.ph`, createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    );
    expect(await invites.invite(input)).toMatchObject({ status: "not_sent", reason: "RECENTLY_INVITED" });
    expect(await invites.invite({ ...input, email: "old@serbizio.ph" })).toMatchObject({ status: "sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a fixed reason, not raw error text, when preparing the invite fails", async () => {
    prisma.organization.findUnique = jest.fn().mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"));
    const outcome = await invites.invite(input);
    expect(outcome).toMatchObject({ status: "not_sent", reason: "INVITE_FAILED", detail: "The invite could not be prepared" });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain("hunter2");
  });
});

describe("adding a member", () => {
  const owner: ConsoleActor = { kind: "member", email: "owner@example.test", subject: "s-owner", platformAdmin: false };
  const req = { consoleActor: owner } as ConsoleRequest;

  function controllerWith(invite: jest.Mock) {
    const db = prisma as unknown as PrismaService;
    const people = new OrganizationPeopleService(db, audit as unknown as AuditEventsService);
    const none = {} as never;
    return new ControlPlaneAdminController(none, new ConsoleAccessService(db), people, none, none, none, none, none, { invite } as unknown as MemberInviteService);
  }

  it("gives project roles in the same step, before the invite goes out, and lists them", async () => {
    prisma.cpProject.rows.push({ id: "prj_ssssssssssssssssssssssss", organizationId: ORG, slug: "serbizio", name: "Serbizio", status: "active" });
    let assignedAtInvite: unknown[] = [];
    const invite = jest.fn(async () => {
      assignedAtInvite = prisma.cpProjectRoleAssignment.rows.map((row) => ({ ...row }));
      return { status: "sent" };
    });
    const controller = controllerWith(invite);

    await controller.setMember(
      { organizationId: ORG, email: "jun@serbizio.ph" },
      { role: "developer", projects: [{ projectId: "prj_ssssssssssssssssssssssss", role: "admin" }] },
      req,
    );

    expect(assignedAtInvite).toEqual([expect.objectContaining({ projectId: "prj_ssssssssssssssssssssssss", memberEmail: "jun@serbizio.ph", role: "admin" })]);
    const listed = await controller.listMembers(ORG, {}, req);
    expect(listed.data.find((member) => member.email === "jun@serbizio.ph")).toMatchObject({
      addedBy: "owner@example.test",
      addedAt: expect.any(String),
      projects: [{ projectId: "prj_ssssssssssssssssssssssss", name: "Serbizio", role: "admin" }],
    });
  });

  it("refuses unknown or repeated projects before changing anything", async () => {
    const invite = jest.fn();
    const controller = controllerWith(invite);
    const project = { projectId: "prj_ssssssssssssssssssssssss", role: "admin" };
    await expect(
      controller.setMember({ organizationId: ORG, email: "jun@serbizio.ph" }, { role: "developer", projects: [project, project] }, req),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      controller.setMember({ organizationId: ORG, email: "jun@serbizio.ph" }, { role: "developer", projects: [project] }, req),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.organizationMember.rows.some((row) => row.email === "jun@serbizio.ph")).toBe(false);
    expect(invite).not.toHaveBeenCalled();
  });

  it("invites a new member, and only a new one", async () => {
    const invite = jest.fn().mockResolvedValue({ status: "not_sent", reason: "EMAIL_NOT_CONFIGURED" });
    const controller = controllerWith(invite);
    const added = await controller.setMember({ organizationId: ORG, email: "jun@serbizio.ph" }, { role: "developer" }, req);
    expect(added.data).toMatchObject({ email: "jun@serbizio.ph", role: "developer", previousRole: null, invite: { status: "not_sent" } });
    expect(invite).toHaveBeenCalledWith({ organizationId: ORG, email: "jun@serbizio.ph", role: "developer", invitedBy: "owner@example.test" });
    expect(prisma.organizationMember.rows.some((row) => row.email === "jun@serbizio.ph")).toBe(true);

    const changed = await controller.setMember({ organizationId: ORG, email: "jun@serbizio.ph" }, { role: "viewer" }, req);
    expect(changed.data).toMatchObject({ previousRole: "developer", invite: null });
    expect(invite).toHaveBeenCalledTimes(1);

    // The inviter's Google name goes into the email when the guard read one.
    const named = { consoleActor: { ...owner, name: "Owner Person" } } as ConsoleRequest;
    await controller.setMember({ organizationId: ORG, email: "ana@serbizio.ph" }, { role: "viewer" }, named);
    expect(invite).toHaveBeenLastCalledWith(expect.objectContaining({ email: "ana@serbizio.ph", invitedByName: "Owner Person" }));
  });

  it("lets an invite be accepted once, before it expires, and renews an expired one", async () => {
    const invite = jest.fn().mockResolvedValue({ status: "sent" });
    const controller = controllerWith(invite);
    const access = new ConsoleAccessService(prisma as unknown as PrismaService);
    const newcomer: ConsoleActor = { kind: "member", email: "ana@serbizio.ph", subject: "s-ana", platformAdmin: false };
    const row = () => prisma.organizationMember.rows.find((candidate) => candidate.email === "ana@serbizio.ph")!;

    await controller.setMember({ organizationId: ORG, email: "ana@serbizio.ph" }, { role: "developer" }, req);
    expect(row()).toMatchObject({ status: "invited", inviteExpiresAt: expect.any(Date) });

    // Expired before the first sign-in: no access.
    row().inviteExpiresAt = new Date(Date.now() - 1000);
    await expect(access.require(newcomer, ORG, "organization.read")).rejects.toMatchObject({ status: 404 });

    // Renewed: the first verified sign-in accepts it and links the identity.
    await controller.resendInvite({ organizationId: ORG, email: "ana@serbizio.ph" }, req);
    expect(invite).toHaveBeenCalledTimes(2);
    consoleAccessCacheFor(prisma).invalidateOrganization(ORG);
    await expect(access.require(newcomer, ORG, "organization.read")).resolves.toBeDefined();
    expect(row()).toMatchObject({ status: "active", inviteExpiresAt: null, subject: "s-ana" });

    await expect(controller.resendInvite({ organizationId: ORG, email: "ana@serbizio.ph" }, req)).rejects.toMatchObject({ code: "INVITE_ALREADY_ACCEPTED" });
  });

  it("suspends and restores an accepted member, never the last owner", async () => {
    const controller = controllerWith(jest.fn());
    prisma.organizationMember.rows.push({ organizationId: ORG, email: "dev@serbizio.ph", role: "developer", status: "active", inviteExpiresAt: null, subject: "s-dev" });
    const dev: ConsoleActor = { kind: "member", email: "dev@serbizio.ph", subject: "s-dev", platformAdmin: false };
    const access = new ConsoleAccessService(prisma as unknown as PrismaService);

    await controller.setMemberStatus({ organizationId: ORG, email: "dev@serbizio.ph" }, { status: "suspended" }, req);
    await expect(access.require(dev, ORG, "organization.read")).rejects.toMatchObject({ status: 404 });
    await controller.setMemberStatus({ organizationId: ORG, email: "dev@serbizio.ph" }, { status: "active" }, req);
    await expect(access.require(dev, ORG, "organization.read")).resolves.toBeDefined();

    await expect(controller.setMemberStatus({ organizationId: ORG, email: "owner@example.test" }, { status: "suspended" }, req)).rejects.toMatchObject({
      code: "LAST_OWNER",
    });
  });
});
