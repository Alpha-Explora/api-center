import { generateKeyPairSync, randomUUID } from "node:crypto";
import { loadRuntimeContextKeys, verifyRuntimeContext } from "@apicenter/runtime";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ApplicationAccessService } from "../../../../apps/gateway/src/domains/control-plane/application-access.service";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { QuotaService } from "../../../../apps/gateway/src/domains/control-plane/quota.service";
import { ConsoleAccessService } from "../../../../apps/gateway/src/domains/control-plane/console-access.service";
import { TestRecipientsController } from "../../../../apps/gateway/src/domains/control-plane/test-recipients.controller";
import {
  TestRecipientsService,
  deliveryRecipients,
  normalizeRecipient,
} from "../../../../apps/gateway/src/domains/control-plane/test-recipients.service";
import type { ConsoleActor } from "../../../../apps/gateway/src/domains/control-plane/console-access.policy";
import type { ConsoleRequest } from "../../../../apps/gateway/src/domains/control-plane/console-actor.guard";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000f1";
const actor = "admin@example.test";

describe("normalizeRecipient", () => {
  it("stores E.164 numbers without separators and emails in lower case", () => {
    expect(normalizeRecipient(" +63 (917) 123-4567 ")).toBe("+639171234567");
    expect(normalizeRecipient(" Dana@Example.COM ")).toBe("dana@example.com");
  });

  it("refuses anything that is neither", () => {
    for (const value of ["09171234567", "+0123456789", "dana@", "not an address", 42, undefined]) {
      expect(normalizeRecipient(value)).toBeUndefined();
    }
  });
});

describe("deliveryRecipients", () => {
  it("names who an email, SMS or OTP send would reach", () => {
    expect(deliveryRecipients("sms", "POST", "/send", { to: "+639171234567" })).toEqual(["+639171234567"]);
    expect(deliveryRecipients("email", "POST", "/send/", { to: ["a@x.test", "b@x.test"] })).toEqual(["a@x.test", "b@x.test"]);
    expect(deliveryRecipients("otp", "POST", "/generate", { recipient: "a@x.test", channel: "email" })).toEqual(["a@x.test"]);
    expect(deliveryRecipients("otp", "POST", "/generate", { target: "+639171234567", channel: "sms" })).toEqual(["+639171234567"]);
  });

  it("is undefined for requests that deliver nothing", () => {
    expect(deliveryRecipients("otp", "POST", "/verify", { otpId: "otp_1", code: "123456" })).toBeUndefined();
    expect(deliveryRecipients("sms", "GET", "/status/msg_1", undefined)).toBeUndefined();
    expect(deliveryRecipients("geo", "POST", "/geocode", { address: "Manila" })).toBeUndefined();
  });
});

describe("test sends on the request path", () => {
  let prisma: FakeControlPlanePrisma;
  let admin: ControlPlaneAdminService;
  let recipients: TestRecipientsService;
  let access: ApplicationAccessService;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keys = loadRuntimeContextKeys(JSON.stringify([{ ...publicKey.export({ format: "jwk" }), kid: "k" }])) as Map<string, unknown>;

  beforeEach(() => {
    process.env.DATABASE_ENABLED = "true";
    prisma = createFakeControlPlanePrisma();
    prisma.organization.rows.push({ id: ORG, status: "active" });
    const db = prisma as unknown as PrismaService;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
    admin = new ControlPlaneAdminService(db, audit);
    recipients = new TestRecipientsService(db, audit);
    access = new ApplicationAccessService(
      db,
      new RuntimeContextSigner({ APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k" }) }),
      new QuotaService(db, audit),
      undefined,
      recipients,
    );
  });

  async function smsKey() {
    const project = await admin.createProject(ORG, { slug: "shop", name: "Shop" }, actor);
    const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
    await admin.setCapability(scope, "sms", true, actor);
    const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
    await admin.grant(scope, app.id, { capability: "sms", action: "sms:send" }, actor);
    const { secret } = await admin.issueCredential(scope, app.id, { operationId: randomUUID() }, actor);
    const send = (to: string) =>
      access.authorize({ bearer: secret, capability: "sms", method: "POST", relativePath: "/send", requestId: randomUUID(), recipients: [to] });
    return { project, send };
  }

  const claims = (context: string) => verifyRuntimeContext(context, { audience: "apicenter-runtime:sms", keys }) as { suppressDelivery: boolean };

  it("suppresses delivery to a recipient the project has not registered, and delivers to one it has", async () => {
    const { project, send } = await smsKey();

    const stranger = await send("+639170000000");
    expect(stranger.deliverySuppressed).toBe(true);
    expect(claims(stranger.signedContext).suppressDelivery).toBe(true);

    await recipients.add(ORG, project.id, "+63 917 123 4567", actor);
    const teammate = await send("+639171234567");
    expect(teammate.deliverySuppressed).toBeUndefined();
    expect(claims(teammate.signedContext).suppressDelivery).toBe(false);
  });

  it("suppresses an email send when any one of its recipients is not registered", async () => {
    const { project } = await smsKey();
    await recipients.add(ORG, project.id, "dana@example.test", actor);
    await expect(recipients.shouldSuppress(ORG, project.id, ["Dana@Example.test"])).resolves.toBe(false);
    await expect(recipients.shouldSuppress(ORG, project.id, ["dana@example.test", "eve@example.test"])).resolves.toBe(true);
  });

  it("keeps recipients unique and bounded", async () => {
    const { project } = await smsKey();
    await recipients.add(ORG, project.id, "dana@example.test", actor);
    await expect(recipients.add(ORG, project.id, "DANA@example.test", actor)).rejects.toMatchObject({ status: 409 });
    await expect(recipients.add(ORG, project.id, "0917", actor)).rejects.toMatchObject({ status: 400 });
    await expect(recipients.remove(ORG, project.id, "dana@example.test", actor)).resolves.toMatchObject({ removed: true });
    await expect(recipients.remove(ORG, project.id, "dana@example.test", actor)).rejects.toMatchObject({ status: 404 });
  });
});

describe("TestRecipientsController", () => {
  const member = (email: string): ConsoleActor => ({ kind: "member", email, subject: `sub-${email}`, platformAdmin: false });
  const req = (consoleActor: ConsoleActor) => ({ consoleActor }) as ConsoleRequest;

  it("lets developers manage test recipients and viewers only read them", async () => {
    process.env.DATABASE_ENABLED = "true";
    const prisma = createFakeControlPlanePrisma();
    prisma.organization.rows.push({ id: ORG, status: "active" });
    prisma.organizationMember.rows.push(
      { organizationId: ORG, email: "dev@example.test", role: "developer", status: "active", subject: null },
      { organizationId: ORG, email: "viewer@example.test", role: "viewer", status: "active", subject: null },
    );
    const db = prisma as unknown as PrismaService;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
    const project = await new ControlPlaneAdminService(db, audit).createProject(ORG, { slug: "shop", name: "Shop" }, actor);
    for (const email of ["dev@example.test", "viewer@example.test"]) {
      prisma.cpProjectRoleAssignment.rows.push({
        id: `pra_${email.slice(0, 3)}`,
        organizationId: ORG,
        projectId: project.id,
        memberEmail: email,
        teamId: null,
        role: email.startsWith("dev") ? "developer" : "viewer",
      });
    }
    const controller = new TestRecipientsController(new TestRecipientsService(db, audit), new ConsoleAccessService(db));
    const params = { organizationId: ORG, projectId: project.id };

    await controller.add(params, { recipient: "+639171234567" }, req(member("dev@example.test")));
    await expect(controller.add(params, { recipient: "+639170000000" }, req(member("viewer@example.test")))).rejects.toMatchObject({ status: 403 });
    await expect(controller.list(params, req(member("viewer@example.test")))).resolves.toMatchObject({
      data: [expect.objectContaining({ recipient: "+639171234567" })],
    });
  });
});
