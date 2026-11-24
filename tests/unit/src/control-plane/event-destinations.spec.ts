import { randomUUID } from "node:crypto";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import type { PaymentPubSubProvisioningService } from "../../../../apps/gateway/src/domains/payments/features/pubsub-provisioning/payment-pubsub-provisioning.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { LiveEnvironmentService } from "../../../../apps/gateway/src/domains/control-plane/live-environment.service";
import type { ApprovalRequestService } from "../../../../apps/gateway/src/domains/governance/approvals/approval-request.service";
import { EventDestinationService, ROTATION_OVERLAP_MS } from "../../../../apps/gateway/src/domains/control-plane/event-destinations/event-destination.service";
import { createMemoryWebhookConfigStore } from "../../../../apps/gateway/src/domains/control-plane/event-destinations/webhook-config-store";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-000000000201";
const actor = "admin@example.test";

let prisma: FakeControlPlanePrisma;
let admin: ControlPlaneAdminService;
let provisioner: { provision: jest.Mock };
let destinations: EventDestinationService;
let webhookConfigs: ReturnType<typeof createMemoryWebhookConfigStore>;

beforeEach(() => {
  process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/apicenter_test";
  process.env.PAYMENTS_MERCHANT_ORGANIZATION_IDS = ORG;
  prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, status: "active" });
  const db = prisma as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
  admin = new ControlPlaneAdminService(db, audit);
  provisioner = { provision: jest.fn().mockResolvedValue({ subscriptionName: "apicenter.payment-events.test.app_x" }) };
  webhookConfigs = createMemoryWebhookConfigStore();
  destinations = new EventDestinationService(db, provisioner as unknown as PaymentPubSubProvisioningService, audit, webhookConfigs);
});

async function setup(enablePayments = true) {
  const project = await admin.createProject(ORG, { slug: "shop", name: "Shop" }, actor);
  const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
  if (enablePayments) await admin.setCapability(scope, "payments", true, actor);
  const app = await admin.createApplication(scope, { slug: "worker", name: "Worker" }, actor);
  return { project, scope, app };
}

const delivery = { url: "https://8.8.8.8/payments/events" };

describe("event destinations", () => {
  beforeEach(() => {
    process.env.WEBHOOK_DELIVERY_URL = "https://apicenter-webhooks-live-xyz-as.a.run.app";
    process.env.WEBHOOK_PUSH_SERVICE_ACCOUNT = "apicenter-webhook-push@apicenter.iam.gserviceaccount.com";
  });
  afterEach(() => {
    delete process.env.WEBHOOK_DELIVERY_URL;
    delete process.env.WEBHOOK_PUSH_SERVICE_ACCOUNT;
  });

  it("provisions a subscription filtered to the recipient application", async () => {
    const { scope, app } = await setup();
    const destination = await destinations.createWebhook(scope, { recipientApplicationId: app.id, ...delivery }, actor);
    expect(provisioner.provision).toHaveBeenCalledWith(
      expect.objectContaining({ consumerServiceId: app.id, ownerTribeId: ORG, environment: "test", endpointEnvironment: "test" }),
    );
    expect(destination).toMatchObject({ status: "active", subscriptionName: "apicenter.payment-events.test.app_x" });
  });

  it("records a failed provisioning without hiding it", async () => {
    const { scope, app } = await setup();
    provisioner.provision.mockRejectedValue(new Error("pushEndpoint must be a Cloud Run run.app URL"));
    const destination = await destinations.createWebhook(scope, { recipientApplicationId: app.id, ...delivery }, actor);
    expect(destination).toMatchObject({ status: "failed", lastError: "pushEndpoint must be a Cloud Run run.app URL" });
  });

  it("requires payments in the environment and one destination per application", async () => {
    const withoutPayments = await setup(false);
    await expect(
      destinations.createWebhook(withoutPayments.scope, { recipientApplicationId: withoutPayments.app.id, ...delivery }, actor),
    ).rejects.toMatchObject({ code: "CAPABILITY_NOT_ENABLED" });

    const { scope, app } = await (async () => {
      const project = await admin.createProject(ORG, { slug: "second", name: "Second" }, actor);
      const s = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
      await admin.setCapability(s, "payments", true, actor);
      return { scope: s, app: await admin.createApplication(s, { slug: "worker", name: "Worker" }, actor) };
    })();
    await destinations.createWebhook(scope, { recipientApplicationId: app.id, ...delivery }, actor);
    await expect(destinations.createWebhook(scope, { recipientApplicationId: app.id, ...delivery }, actor)).rejects.toMatchObject({ status: 409 });
  });

  it("rejects a recipient from another environment", async () => {
    const { scope } = await setup();
    await expect(
      destinations.createWebhook(scope, { recipientApplicationId: `app_${randomUUID().replaceAll("-", "").slice(0, 24)}`, ...delivery }, actor),
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
    await destinations.createWebhook(scope, { recipientApplicationId: app.id, ...delivery }, actor);
    expect(provisioner.provision).toHaveBeenCalledWith(expect.objectContaining({ ownerTribeId: "commerce-tribe" }));
  });
});

describe("webhook destinations", () => {
  const DELIVERY_URL = "https://apicenter-webhooks-live-xyz-as.a.run.app";
  const PUSH_ACCOUNT = "apicenter-webhook-push@apicenter.iam.gserviceaccount.com";
  // A public address, so the URL check does not depend on DNS in tests.
  const URL = "https://8.8.8.8/apicenter/events";

  beforeEach(() => {
    process.env.WEBHOOK_DELIVERY_URL = `${DELIVERY_URL}/`;
    process.env.WEBHOOK_PUSH_SERVICE_ACCOUNT = PUSH_ACCOUNT;
  });
  afterEach(() => {
    delete process.env.WEBHOOK_DELIVERY_URL;
    delete process.env.WEBHOOK_PUSH_SERVICE_ACCOUNT;
  });

  it("stores the URL and a whsec_ secret, then subscribes the delivery service for this application", async () => {
    const { scope, app } = await setup();
    const created = await destinations.createWebhook(scope, { recipientApplicationId: app.id, url: URL }, actor);

    expect(created.signingSecret).toMatch(/^whsec_[A-Za-z0-9+/]{43}=$/);
    expect(created).toMatchObject({ transport: "webhook", webhookUrl: URL, status: "active" });
    expect(await webhookConfigs.read(created.id)).toEqual({ url: URL, secrets: [{ value: created.signingSecret }] });
    expect(provisioner.provision).toHaveBeenCalledWith(
      expect.objectContaining({
        consumerServiceId: app.id,
        pushEndpoint: `${DELIVERY_URL}/deliveries/${created.id}`,
        oidcAudience: DELIVERY_URL,
        deliveryServiceAccountEmail: PUSH_ACCOUNT,
      }),
    );
    // The secret is never persisted with the destination row.
    expect(JSON.stringify(prisma.cpEventDestination.rows)).not.toContain(created.signingSecret);
  });

  it("refuses private, plain-http and internal URLs before creating anything", async () => {
    const { scope, app } = await setup();
    for (const url of ["http://8.8.8.8/hook", "https://10.0.0.5/hook", "https://169.254.169.254/latest", "https://metadata.google.internal/x"]) {
      await expect(destinations.createWebhook(scope, { recipientApplicationId: app.id, url }, actor)).rejects.toMatchObject({ code: "UPSTREAM_NOT_ALLOWED" });
    }
    expect(prisma.cpEventDestination.rows).toHaveLength(0);
    expect(provisioner.provision).not.toHaveBeenCalled();
  });

  it("reports webhook delivery as unconfigured instead of half-creating a destination", async () => {
    const { scope, app } = await setup();
    delete process.env.WEBHOOK_DELIVERY_URL;
    await expect(destinations.createWebhook(scope, { recipientApplicationId: app.id, url: URL }, actor)).rejects.toMatchObject({ code: "WEBHOOKS_NOT_CONFIGURED" });
    expect(prisma.cpEventDestination.rows).toHaveLength(0);
  });

  it("rotates with a day of overlap, keeping only the newest previous secret", async () => {
    const { scope, app } = await setup();
    const created = await destinations.createWebhook(scope, { recipientApplicationId: app.id, url: URL }, actor);
    const first = await destinations.rotateSecret(scope, created.id, actor);
    const second = await destinations.rotateSecret(scope, created.id, actor);

    const config = await webhookConfigs.read(created.id);
    expect(config?.secrets.map((secret) => secret.value)).toEqual([second.signingSecret, first.signingSecret]);
    expect(config?.secrets[0].expiresAt).toBeUndefined();
    const overlap = Date.parse(config!.secrets[1].expiresAt!) - Date.now();
    expect(overlap).toBeGreaterThan(ROTATION_OVERLAP_MS - 60_000);
    expect(overlap).toBeLessThanOrEqual(ROTATION_OVERLAP_MS);
    expect(second.secretRotatedAt).toBeInstanceOf(Date);
  });

  it("marks a disabled webhook so the delivery service drops its events, and refuses rotating it", async () => {
    const { scope, app } = await setup();
    const created = await destinations.createWebhook(scope, { recipientApplicationId: app.id, url: URL }, actor);
    await destinations.disable(scope, created.id, actor);
    expect(await webhookConfigs.read(created.id)).toMatchObject({ disabled: true });
    await expect(destinations.rotateSecret(scope, created.id, actor)).rejects.toMatchObject({ status: 409 });
  });

  it("never rotates or disables a live webhook through the test environment", async () => {
    const { project, scope: test } = await setup();
    const approvals = { assertApprovedForAction: jest.fn() } as unknown as ApprovalRequestService;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
    await new LiveEnvironmentService(prisma as unknown as PrismaService, approvals, audit).provision(ORG, project.id, actor);
    const live = { ...test, environmentKind: "live" as const };
    await admin.setCapability(live, "payments", true, actor);
    const liveApp = await admin.createApplication(live, { slug: "live-worker", name: "Live worker" }, actor);
    const created = await destinations.createWebhook(live, { recipientApplicationId: liveApp.id, url: URL }, actor);

    await expect(destinations.rotateSecret(test, created.id, actor)).rejects.toMatchObject({ status: 404 });
    await expect(destinations.disable(test, created.id, actor)).rejects.toMatchObject({ status: 404 });
    expect(await webhookConfigs.read(created.id)).toEqual({ url: URL, secrets: [{ value: created.signingSecret }] });
    expect(prisma.cpEventDestination.rows.find((row) => row.id === created.id)).toMatchObject({ status: "active" });
  });

  it("does not rotate a Pub/Sub push destination", async () => {
    const { scope, app } = await setup();
    const destination = await destinations.createWebhook(scope, { recipientApplicationId: app.id, ...delivery }, actor);
    await prisma.cpEventDestination.update({ where: { id: destination.id }, data: { transport: "pubsub-push" } });
    await expect(destinations.rotateSecret(scope, destination.id, actor)).rejects.toMatchObject({ code: "NOT_A_WEBHOOK" });
  });
});
