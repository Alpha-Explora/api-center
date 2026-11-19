import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ApplicationAccessService } from "../../../../apps/gateway/src/domains/control-plane/application-access.service";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { QuotaService } from "../../../../apps/gateway/src/domains/control-plane/quota.service";
import { WhoAmIController } from "../../../../apps/gateway/src/domains/control-plane/whoami.controller";
import { createFakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-0000000000f1";
const actor = "admin@example.test";

describe("whoami", () => {
  let admin: ControlPlaneAdminService;
  let access: ApplicationAccessService;

  beforeEach(() => {
    process.env.DATABASE_ENABLED = "true";
    const prisma = createFakeControlPlanePrisma();
    prisma.organization.rows.push({ id: ORG, status: "active" });
    const db = prisma as unknown as PrismaService;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
    const { privateKey } = generateKeyPairSync("ed25519");
    admin = new ControlPlaneAdminService(db, audit);
    access = new ApplicationAccessService(
      db,
      new RuntimeContextSigner({ APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k" }) }),
      new QuotaService(db, audit),
    );
  });

  async function keyWithGrants() {
    const project = await admin.createProject(ORG, { slug: "serbizio", name: "Serbizio" }, actor);
    const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
    await admin.setCapability(scope, "email", true, actor);
    const app = await admin.createApplication(scope, { slug: "backend", name: "Backend" }, actor);
    await admin.grant(scope, app.id, { capability: "email", action: "email:send" }, actor);
    const issued = await admin.issueCredential(scope, app.id, { operationId: randomUUID() }, actor);
    return { project, scope, app, issued };
  }

  it("describes the key's application, project, environment and grants", async () => {
    const { project, app, issued } = await keyWithGrants();
    await expect(new WhoAmIController(access).whoami(`Bearer ${issued.secret}`)).resolves.toEqual({
      success: true,
      data: {
        application: { id: app.id, slug: "backend", name: "Backend" },
        project: { id: project.id },
        organizationId: ORG,
        environment: "test",
        grants: ["email:send"],
      },
    });
  });

  it("refuses a missing, unknown or revoked key", async () => {
    const { scope, app, issued } = await keyWithGrants();
    const controller = new WhoAmIController(access);
    await expect(controller.whoami(undefined)).rejects.toMatchObject({ status: 401 });
    await expect(access.whoami(`ak_test_abcdefghijklmnop_${"B".repeat(43)}`)).rejects.toMatchObject({ status: 401 });
    await admin.revokeCredential(scope, app.id, issued.id, "rotated", actor);
    await expect(access.whoami(issued.secret)).rejects.toMatchObject({ code: "CREDENTIAL_REVOKED" });
  });
});
