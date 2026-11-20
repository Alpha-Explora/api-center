import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import type { ConsoleRequest } from "../../../../apps/gateway/src/domains/control-plane/console-actor.guard";
import type { ConsoleActor } from "../../../../apps/gateway/src/domains/control-plane/console-access.policy";
import { ControlPlaneAdminController } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.controller";
import { ConsoleAccessService } from "../../../../apps/gateway/src/domains/control-plane/console-access.service";
import { OrganizationPeopleService } from "../../../../apps/gateway/src/domains/control-plane/organization-people.service";
import { MemberInviteService } from "../../../../apps/gateway/src/domains/control-plane/member-invite.service";
import { consoleUrlFrom, inviteMessage, DEFAULT_CONSOLE_URL } from "../../../../apps/gateway/src/domains/control-plane/member-invite";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000d1";
const ENV_KEYS = ["EMAIL_ADMIN_TOKEN", "SHARED_SERVICE_ROUTE_EMAIL_LIVE", "MANAGEMENT_CONSOLE_URL", "CLOUD_RUN_AUTH_ENABLED"] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string>> = {};

let prisma: FakeControlPlanePrisma;
let audit: { record: jest.Mock };
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
  audit = { record: jest.fn().mockResolvedValue(undefined) };
  invites = new MemberInviteService(prisma as unknown as PrismaService, audit as unknown as AuditEventsService);
  fetchMock = jest.fn().mockResolvedValue(respond(201, { success: true, data: { messageId: "msg_1", status: "queued", provider: "resend" } }));
  invites.useFetch(fetchMock);
});

describe("invite message", () => {
  it("names the organization, the role, the email to sign in with and the console URL", () => {
    const message = inviteMessage({ organizationName: "Serbizio", email: "jun@serbizio.ph", role: "admin", consoleUrl: "https://console.test", invitedBy: "maria@serbizio.ph" });
    expect(message.subject).toBe("You have been added to Serbizio on APICenter");
    expect(message.text).toContain("maria@serbizio.ph added you to Serbizio on APICenter as an admin.");
    expect(message.text).toContain("jun@serbizio.ph");
    expect(message.text).toContain("https://console.test");
  });

  it("does not name a platform caller as the inviter and escapes HTML", () => {
    const message = inviteMessage({ organizationName: "<b>Acme</b>", email: "a@b.test", role: "viewer", consoleUrl: "https://c.test", invitedBy: "platform:ops" });
    expect(message.text.startsWith("You have been added to <b>Acme</b>")).toBe(true);
    expect(message.html).toContain("&lt;b&gt;Acme&lt;/b&gt;");
    expect(message.html).not.toContain("<b>Acme</b>");
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
    expect(JSON.parse(init.body)).toMatchObject({ to: "jun@serbizio.ph", subject: "You have been added to Serbizio on APICenter" });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ type: "control_plane.member.invite_sent", resourceId: `${ORG}:jun@serbizio.ph` }));
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
  });
});
