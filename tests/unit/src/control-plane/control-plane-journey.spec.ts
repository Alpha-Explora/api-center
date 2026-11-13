import { generateKeyPairSync, randomUUID } from "node:crypto";
import { loadRuntimeContextKeys, verifyRuntimeContext } from "@apicenter/runtime";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ApplicationAccessService } from "../../../../apps/gateway/src/domains/control-plane/application-access.service";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-000000000001";
const OTHER_ORG = "6f1c1d1e-0000-4000-8000-000000000002";
const actor = "admin@example.test";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const signer = new RuntimeContextSigner({
  APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k1" }),
});
const runtimeKeys = loadRuntimeContextKeys(JSON.stringify([{ ...publicKey.export({ format: "jwk" }), kid: "k1" }]));

let prisma: FakeControlPlanePrisma;
let admin: ControlPlaneAdminService;
let access: ApplicationAccessService;
let audit: { record: jest.Mock };

beforeAll(() => {
  process.env.DATABASE_ENABLED = "true";
});

beforeEach(() => {
  prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, status: "active" }, { id: OTHER_ORG, status: "active" });
  audit = { record: jest.fn().mockResolvedValue(undefined) };
  admin = new ControlPlaneAdminService(prisma as unknown as PrismaService, audit as unknown as AuditEventsService);
  access = new ApplicationAccessService(prisma as unknown as PrismaService, signer);
});

async function onboard(organizationId = ORG, slug = "serbizio") {
  const project = await admin.createProject(organizationId, { slug, name: "Serbizio" }, actor);
  const scope = { organizationId, projectId: project.id, environmentKind: "test" as const };
  await admin.setCapability(scope, "email", true, actor);
  const application = await admin.createApplication(scope, { slug: "api", name: "API server" }, actor);
  return { project, scope, application };
}

function emailSend(bearer: string, relativePath = "/send", method = "POST") {
  return { bearer, capability: "email", method, relativePath, requestId: randomUUID() };
}

describe("control plane: test onboarding without API publication", () => {
  it("creates an organization-owned project with only a test environment", async () => {
    const project = await admin.createProject(ORG, { slug: "serbizio", name: "Serbizio" }, actor);
    expect(project.id).toMatch(/^prj_/);
    expect(project.organizationId).toBe(ORG);
    expect(project.environments).toEqual([{ id: expect.stringMatching(/^env_/), kind: "test", status: "active", capabilities: [] }]);
    expect(prisma.cpProject.rows[0]).not.toHaveProperty("tribeId");
  });

  it("authorizes a granted request and signs a context the email runtime accepts", async () => {
    const { scope, application } = await onboard();
    await admin.grant(scope, application.id, { capability: "email", action: "email:send" }, actor);
    const credential = await admin.issueCredential(scope, application.id, { operationId: randomUUID() }, actor);

    expect(credential.secret).toMatch(/^ak_test_/);
    expect(JSON.stringify(prisma.cpCredential.rows)).not.toContain(credential.secret);

    const call = await access.authorize(emailSend(credential.secret));
    expect(call.action).toBe("email:send");
    expect(call.identity).toMatchObject({ organizationId: ORG, applicationId: application.id, environmentKind: "test" });

    const claims = verifyRuntimeContext(call.signedContext, { audience: "apicenter-runtime:email", keys: runtimeKeys });
    expect(claims).toMatchObject({ organizationId: ORG, projectId: scope.projectId, applicationId: application.id, action: "email:send" });
  });

  it("denies an action the application was not granted, even with the capability enabled", async () => {
    const { scope, application } = await onboard();
    await admin.grant(scope, application.id, { capability: "email", action: "email:send" }, actor);
    const { secret } = await admin.issueCredential(scope, application.id, { operationId: randomUUID() }, actor);

    await expect(access.authorize(emailSend(secret, "/status/msg_1", "GET"))).rejects.toMatchObject({
      code: "ACTION_NOT_GRANTED",
      status: 403,
    });
  });

  it("does not let a sibling application's grant authorize another application in the same project", async () => {
    const { scope, application } = await onboard();
    const worker = await admin.createApplication(scope, { slug: "worker", name: "Worker" }, actor);
    await admin.grant(scope, application.id, { capability: "email", action: "email:send" }, actor);
    const { secret } = await admin.issueCredential(scope, worker.id, { operationId: randomUUID() }, actor);

    await expect(access.authorize(emailSend(secret))).rejects.toMatchObject({ code: "ACTION_NOT_GRANTED" });
  });

  it("stops authorizing immediately after a grant or credential is revoked", async () => {
    const { scope, application } = await onboard();
    const grant = await admin.grant(scope, application.id, { capability: "email", action: "email:send" }, actor);
    const credential = await admin.issueCredential(scope, application.id, { operationId: randomUUID() }, actor);
    await expect(access.authorize(emailSend(credential.secret))).resolves.toBeDefined();

    await admin.revokeGrant(scope, application.id, grant.id, actor);
    await expect(access.authorize(emailSend(credential.secret))).rejects.toMatchObject({ code: "ACTION_NOT_GRANTED" });

    await admin.grant(scope, application.id, { capability: "email", action: "email:send" }, actor);
    await admin.revokeCredential(scope, application.id, credential.id, "rotated", actor);
    await expect(access.authorize(emailSend(credential.secret))).rejects.toMatchObject({ code: "CREDENTIAL_REVOKED", status: 401 });
  });

  it("rejects an unknown or altered key without revealing which part failed", async () => {
    const { scope, application } = await onboard();
    const { secret } = await admin.issueCredential(scope, application.id, { operationId: randomUUID() }, actor);
    await expect(access.authorize(emailSend(`${secret.slice(0, -2)}xx`))).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    await expect(access.authorize(emailSend("ak_test_aaaaaaaaaaaaaaaa_" + "b".repeat(43)))).rejects.toMatchObject({ status: 401 });
  });

  it("keeps organizations isolated: another organization's IDs resolve to not found", async () => {
    const mine = await onboard(ORG);
    await expect(
      admin.createApplication({ ...mine.scope, organizationId: OTHER_ORG }, { slug: "intruder", name: "Intruder" }, actor),
    ).rejects.toMatchObject({ status: 404 });
    await expect(admin.getProject(OTHER_ORG, mine.project.id)).rejects.toMatchObject({ status: 404 });
  });

  it("allows the same project slug in different organizations but not twice in one", async () => {
    await admin.createProject(ORG, { slug: "shop", name: "Shop" }, actor);
    await expect(admin.createProject(OTHER_ORG, { slug: "shop", name: "Shop" }, actor)).resolves.toBeDefined();
    await expect(admin.createProject(ORG, { slug: "shop", name: "Shop" }, actor)).rejects.toMatchObject({ status: 409 });
  });
});

describe("control plane: grants and credential issuance", () => {
  it("rejects actions that are not catalogued for the capability", async () => {
    const { scope, application } = await onboard();
    await expect(admin.grant(scope, application.id, { capability: "email", action: "sms:send" }, actor)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("returns the existing grant instead of duplicating it", async () => {
    const { scope, application } = await onboard();
    const first = await admin.grant(scope, application.id, { capability: "email", action: "email:send" }, actor);
    const second = await admin.grant(scope, application.id, { capability: "email", action: "email:send" }, actor);
    expect(second.id).toBe(first.id);
    expect(prisma.cpApplicationGrant.rows).toHaveLength(1);
  });

  it("never mints twice or re-reveals a secret for a retried operation", async () => {
    const { scope, application } = await onboard();
    const operationId = randomUUID();
    await admin.issueCredential(scope, application.id, { operationId }, actor);

    await expect(admin.issueCredential(scope, application.id, { operationId }, actor)).rejects.toMatchObject({
      code: "CREDENTIAL_ALREADY_ISSUED",
    });
    await expect(admin.issueCredential(scope, application.id, { operationId, expiresInDays: 7 }, actor)).rejects.toMatchObject({
      code: "CREDENTIAL_OPERATION_MISMATCH",
    });
    expect(prisma.cpCredential.rows).toHaveLength(1);
    expect(prisma.advisoryLocks).toEqual([operationId, operationId, operationId]);
  });

  it("refuses live credentials in this slice", async () => {
    const { scope, application } = await onboard();
    await expect(
      admin.issueCredential({ ...scope, environmentKind: "live" }, application.id, { operationId: randomUUID() }, actor),
    ).rejects.toMatchObject({ code: "LIVE_CREDENTIALS_UNAVAILABLE" });
  });

  it("lists credentials without secret material", async () => {
    const { scope, application } = await onboard();
    await admin.issueCredential(scope, application.id, { operationId: randomUUID() }, actor);
    const [listed] = await admin.listCredentials(scope, application.id);
    expect(listed).not.toHaveProperty("secret");
    expect(listed).not.toHaveProperty("verifierSha256");
    expect(listed.lookupPrefix).toMatch(/^ak_test_[a-z0-9]{16}$/);
  });

  it("audits credential issuance without the secret", async () => {
    const { scope, application } = await onboard();
    const { secret } = await admin.issueCredential(scope, application.id, { operationId: randomUUID() }, actor);
    const issued = audit.record.mock.calls.map(([event]) => event).find((event) => event.type === "control_plane.credential.issued");
    expect(issued).toMatchObject({ actor, actionFamily: "secret" });
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain(secret);
  });
});
