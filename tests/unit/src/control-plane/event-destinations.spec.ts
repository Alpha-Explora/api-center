import { randomUUID } from "node:crypto";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import type { PaymentPubSubProvisioningService } from "../../../../apps/gateway/src/domains/payments/features/pubsub-provisioning/payment-pubsub-provisioning.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { EventDestinationService } from "../../../../apps/gateway/src/domains/control-plane/event-destinations/event-destination.service";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-000000000201";
const actor = "admin@example.test";

let prisma: FakeControlPlanePrisma;
let admin: ControlPlaneAdminService;
let provisioner: { provision: jest.Mock };
let destinations: EventDestinationService;

beforeEach(() => {
  process.env.DATABASE_ENABLED = "true";
  process.env.PAYMENTS_MERCHANT_ORGANIZATION_IDS = ORG;
  prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, status: "active" });
  const db = prisma as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
  admin = new ControlPlaneAdminService(db, audit);
  provisioner = { provision: jest.fn().mockResolvedValue({ subscriptionName: "apicenter.payment-events.test.app_x" }) };
  destinations = new EventDestinationService(db, provisioner as unknown as PaymentPubSubProvisioningService, audit);
});

async function setup(enablePayments = true) {
  const project = await admin.createProject(ORG, { slug: "shop", name: "Shop" }, actor);
  const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
  if (enablePayments) await admin.setCapability(scope, "payments", true, actor);
  const app = await admin.createApplication(scope, { slug: "worker", name: "Worker" }, actor);
  return { project, scope, app };
}

const delivery = {
  pushEndpoint: "https://shop-worker-abc-uc.a.run.app/events",
  deliveryServiceAccountEmail: "pubsub-push@shop.iam.gserviceaccount.com",
};

describe("event destinations", () => {
  it("provisions a subscription filtered to the recipient application", async () => {
    const { scope, app } = await setup();
    const destination = await destinations.create(scope, { recipientApplicationId: app.id, ...delivery }, actor);
    expect(provisioner.provision).toHaveBeenCalledWith(
      expect.objectContaining({ consumerServiceId: app.id, ownerTribeId: ORG, environment: "test", endpointEnvironment: "test" }),
    );
    expect(destination).toMatchObject({ status: "active", subscriptionName: "apicenter.payment-events.test.app_x" });
  });

  it("records a failed provisioning without hiding it", async () => {
    const { scope, app } = await setup();
    provisioner.provision.mockRejectedValue(new Error("pushEndpoint must be a Cloud Run run.app URL"));
    const destination = await destinations.create(scope, { recipientApplicationId: app.id, ...delivery }, actor);
    expect(destination).toMatchObject({ status: "failed", lastError: "pushEndpoint must be a Cloud Run run.app URL" });
  });

  it("requires payments in the environment and one destination per application", async () => {
    const withoutPayments = await setup(false);
    await expect(
      destinations.create(withoutPayments.scope, { recipientApplicationId: withoutPayments.app.id, ...delivery }, actor),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_ENABLED" });

    const { scope, app } = await (async () => {
      const project = await admin.createProject(ORG, { slug: "second", name: "Second" }, actor);
      const s = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
      await admin.setCapability(s, "payments", true, actor);
      return { scope: s, app: await admin.createApplication(s, { slug: "worker", name: "Worker" }, actor) };
    })();
    await destinations.create(scope, { recipientApplicationId: app.id, ...delivery }, actor);
    await expect(destinations.create(scope, { recipientApplicationId: app.id, ...delivery }, actor)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a recipient from another environment", async () => {
    const { scope } = await setup();
    await expect(
      destinations.create(scope, { recipientApplicationId: `app_${randomUUID().replaceAll("-", "").slice(0, 24)}`, ...delivery }, actor),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("uses a migrated project's legacy owner for the subscription", async () => {
    const { project, scope, app } = await setup();
    prisma.cpResourceOwnerMapping.rows.push({
      organizationId: ORG,
      projectId: project.id,
      environmentKind: "test",
      ownerGroupId: "commerce-tribe",
      ownerProjectId: "shop",
      migrationRevision: "r1",
    });
    await destinations.create(scope, { recipientApplicationId: app.id, ...delivery }, actor);
    expect(provisioner.provision).toHaveBeenCalledWith(expect.objectContaining({ ownerTribeId: "commerce-tribe" }));
  });
});
