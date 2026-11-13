import { generateKeyPairSync, randomUUID } from "node:crypto";
import { loadRuntimeContextKeys, readSharedServiceCaller } from "@apicenter/runtime";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ApplicationAccessService } from "../../../../apps/gateway/src/domains/control-plane/application-access.service";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { QuotaService } from "../../../../apps/gateway/src/domains/control-plane/quota.service";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const MERCHANT_ORG = "6f1c1d1e-0000-4000-8000-0000000000f1";
const OTHER_ORG = "6f1c1d1e-0000-4000-8000-0000000000f2";
const actor = "admin@example.test";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const keys = loadRuntimeContextKeys(JSON.stringify([{ ...publicKey.export({ format: "jwk" }), kid: "k" }]));

let prisma: FakeControlPlanePrisma;
let admin: ControlPlaneAdminService;
let access: ApplicationAccessService;

beforeEach(() => {
  process.env.DATABASE_ENABLED = "true";
  process.env.PAYMENTS_MERCHANT_ORGANIZATION_IDS = MERCHANT_ORG;
  prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: MERCHANT_ORG, status: "active" }, { id: OTHER_ORG, status: "active" });
  const db = prisma as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
  admin = new ControlPlaneAdminService(db, audit);
  access = new ApplicationAccessService(
    db,
    new RuntimeContextSigner({ APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k" }) }),
    new QuotaService(db, audit),
  );
});

afterEach(() => {
  delete process.env.PAYMENTS_MERCHANT_ORGANIZATION_IDS;
});

async function paymentsApp(organizationId = MERCHANT_ORG) {
  const project = await admin.createProject(organizationId, { slug: "shop", name: "Shop" }, actor);
  const scope = { organizationId, projectId: project.id, environmentKind: "test" as const };
  await admin.setCapability(scope, "payments", true, actor);
  const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
  await admin.grant(scope, app.id, { capability: "payments", action: "payments:checkout:write" }, actor);
  const { secret } = await admin.issueCredential(scope, app.id, { operationId: randomUUID() }, actor);
  return { project, scope, app, secret };
}

describe("payments for control-plane applications", () => {
  it("authorizes only the granted payment actions", async () => {
    const { secret } = await paymentsApp();
    const call = await access.authorizeAction({ bearer: secret, capability: "payments", action: "payments:checkout:write", requestId: randomUUID() });
    expect(call.action).toBe("payments:checkout:write");
    await expect(
      access.authorizeAction({ bearer: secret, capability: "payments", action: "payments:refunds:write", requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "ACTION_NOT_GRANTED" });
    await expect(
      access.authorizeAction({ bearer: secret, capability: "payments", action: "payments:anything", requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "ACTION_NOT_CATALOGED" });
  });

  it("keeps payments behind the shared-service proxy closed", async () => {
    const { secret } = await paymentsApp();
    await expect(
      access.authorize({ bearer: secret, capability: "payments", method: "POST", relativePath: "/checkouts", requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "ACTION_NOT_CATALOGED" });
  });

  it("refuses payments for an organization without the merchant binding", async () => {
    const project = await admin.createProject(OTHER_ORG, { slug: "shop", name: "Shop" }, actor);
    await expect(
      admin.setCapability({ organizationId: OTHER_ORG, projectId: project.id, environmentKind: "test" }, "payments", true, actor),
    ).rejects.toMatchObject({ code: "PAYMENTS_MERCHANT_NOT_BOUND" });
  });

  it("re-checks the merchant binding on every request", async () => {
    const { secret } = await paymentsApp();
    process.env.PAYMENTS_MERCHANT_ORGANIZATION_IDS = "";
    await expect(
      access.authorizeAction({ bearer: secret, capability: "payments", action: "payments:checkout:write", requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "PAYMENTS_MERCHANT_NOT_BOUND" });
  });
});

describe("resource owner", () => {
  it("defaults to the organization and project", async () => {
    const { project, secret } = await paymentsApp();
    const call = await access.authorizeAction({ bearer: secret, capability: "payments", action: "payments:checkout:write", requestId: randomUUID() });
    expect(call.resourceOwner).toEqual({ groupId: MERCHANT_ORG, projectId: project.id });
  });

  it("keeps a migrated project's legacy owner, in the signed context and the runtime caller", async () => {
    const project = await admin.createProject(MERCHANT_ORG, { slug: "legacy", name: "Legacy" }, actor);
    const scope = { organizationId: MERCHANT_ORG, projectId: project.id, environmentKind: "test" as const };
    prisma.cpResourceOwnerMapping.rows.push({
      organizationId: MERCHANT_ORG,
      projectId: project.id,
      environmentKind: "test",
      ownerGroupId: "logistics-tribe",
      ownerProjectId: "logistics-fulfilment",
      migrationRevision: "r1",
    });
    await admin.setCapability(scope, "email", true, actor);
    const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
    await admin.grant(scope, app.id, { capability: "email", action: "email:send" }, actor);
    const { secret } = await admin.issueCredential(scope, app.id, { operationId: randomUUID() }, actor);

    const call = await access.authorize({ bearer: secret, capability: "email", method: "POST", relativePath: "/send", requestId: randomUUID() });
    expect(call.resourceOwner).toEqual({ groupId: "logistics-tribe", projectId: "logistics-fulfilment" });
    const caller = readSharedServiceCaller(
      { get: (name: string) => (name === "X-APICenter-Context" ? call.signedContext : undefined) },
      { production: true, runtimeAudience: "apicenter-runtime:email", contextKeys: keys },
    );
    expect(caller).toMatchObject({ tribeId: "logistics-tribe", projectId: "logistics-fulfilment", serviceId: app.id, model: "application" });
  });
});
