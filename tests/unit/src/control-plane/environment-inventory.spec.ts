import { randomUUID } from "node:crypto";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { EnvironmentInventoryService } from "../../../../apps/gateway/src/domains/control-plane/environment-inventory.service";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-000000000401";
const actor = "admin@example.test";
const DAY = 24 * 60 * 60 * 1000;

let prisma: FakeControlPlanePrisma;
let admin: ControlPlaneAdminService;
let inventory: EnvironmentInventoryService;

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/apicenter_test";
  prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, status: "active" });
  const db = prisma as unknown as PrismaService;
  admin = new ControlPlaneAdminService(db, { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService);
  inventory = new EnvironmentInventoryService(db);
});

async function setup() {
  const project = await admin.createProject(ORG, { slug: "shop", name: "Shop" }, actor);
  const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
  await admin.setCapability(scope, "email", true, actor);
  const web = await admin.createApplication(scope, { slug: "web", name: "Web" }, actor);
  const worker = await admin.createApplication(scope, { slug: "worker", name: "Worker" }, actor);
  return { project, scope, web, worker };
}

const issue = (scope: Parameters<ControlPlaneAdminService["issueCredential"]>[0], applicationId: string, expiresInDays: number) =>
  admin.issueCredential(scope, applicationId, { operationId: randomUUID(), expiresInDays }, actor);

describe("environment inventory", () => {
  it("lists every application's active keys, soonest expiry first, without revoked keys or secrets", async () => {
    const { scope, web, worker } = await setup();
    const later = await issue(scope, web.id, 90);
    const soon = await issue(scope, worker.id, 5);
    const revoked = await issue(scope, worker.id, 3);
    await admin.revokeCredential(scope, worker.id, revoked.id, "rotated", actor);

    const listed = await inventory.activeCredentials(scope);
    expect(listed.map((entry) => entry.id)).toEqual([soon.id, later.id]);
    expect(listed[0]).toMatchObject({ applicationId: worker.id, lookupPrefix: soon.lookupPrefix, status: "active" });
    expect(Object.keys(listed[0]).sort()).toEqual(["applicationId", "createdAt", "expiresAt", "id", "lastUsedAt", "lookupPrefix", "status"]);
  });

  it("narrows to keys expiring within the window, including ones already expired", async () => {
    const { scope, web, worker } = await setup();
    await issue(scope, web.id, 90);
    const soon = await issue(scope, worker.id, 10);
    const expired = await issue(scope, web.id, 30);
    const row = prisma.cpCredential.rows.find((entry) => entry.id === expired.id)!;
    row.expiresAt = new Date(Date.now() - DAY);

    const expiring = await inventory.activeCredentials(scope, { expiringWithinDays: 14 });
    expect(expiring.map((entry) => entry.id)).toEqual([expired.id, soon.id]);
  });

  it("lists active grants across applications and nothing from the other environment", async () => {
    const { scope, web, worker } = await setup();
    await admin.grant(scope, web.id, { capability: "email", action: "email:send" }, actor);
    const revoked = await admin.grant(scope, worker.id, { capability: "email", action: "email:send" }, actor);
    await admin.revokeGrant(scope, worker.id, revoked.id, actor);

    const grants = await inventory.activeGrants(scope);
    expect(grants).toEqual([expect.objectContaining({ applicationId: web.id, targetKind: "capability", capability: "email", action: "email:send" })]);
    await expect(inventory.activeGrants({ ...scope, environmentKind: "live" })).rejects.toMatchObject({ status: 404 });
  });
});
