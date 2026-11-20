import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import type { PaymentPubSubProvisioningService } from "../../../../apps/gateway/src/domains/payments/features/pubsub-provisioning/payment-pubsub-provisioning.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { EventDestinationService } from "../../../../apps/gateway/src/domains/control-plane/event-destinations/event-destination.service";
import { createMemoryWebhookConfigStore } from "../../../../apps/gateway/src/domains/control-plane/event-destinations/webhook-config-store";
import { WebhookDeliveriesService } from "../../../../apps/gateway/src/domains/control-plane/event-destinations/webhook-deliveries.service";
import { createRuntimeDeliveryHistory, type WebhookDelivery } from "../../../../apps/gateway/src/domains/control-plane/event-destinations/webhook-delivery-history";
import { buildTestEvent, createPubSubTestEventPublisher, type TestEventMessage } from "../../../../apps/gateway/src/domains/control-plane/event-destinations/webhook-test-event";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-000000000301";
const actor = "admin@example.test";
const URL = "https://8.8.8.8/apicenter/events";

let prisma: FakeControlPlanePrisma;
let admin: ControlPlaneAdminService;
let destinations: EventDestinationService;
let deliveries: WebhookDeliveriesService;
let audit: { record: jest.Mock };
let published: Array<{ environment: string; message: TestEventMessage }>;
let history: { list: jest.Mock };

beforeEach(() => {
  process.env.DATABASE_ENABLED = "true";
  process.env.PAYMENTS_MERCHANT_ORGANIZATION_IDS = ORG;
  process.env.WEBHOOK_DELIVERY_URL = "https://apicenter-webhooks-live-xyz-as.a.run.app";
  process.env.WEBHOOK_PUSH_SERVICE_ACCOUNT = "apicenter-webhook-push@apicenter.iam.gserviceaccount.com";
  prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, status: "active" });
  const db = prisma as unknown as PrismaService;
  audit = { record: jest.fn().mockResolvedValue(undefined) };
  admin = new ControlPlaneAdminService(db, audit as unknown as AuditEventsService);
  const provisioner = { provision: jest.fn().mockResolvedValue({ subscriptionName: "apicenter.payment-events.test.app_x" }) };
  destinations = new EventDestinationService(db, provisioner as unknown as PaymentPubSubProvisioningService, audit as unknown as AuditEventsService, createMemoryWebhookConfigStore());
  published = [];
  history = { list: jest.fn().mockResolvedValue([]) };
  deliveries = new WebhookDeliveriesService(db, audit as unknown as AuditEventsService, history, {
    publish: async (environment, message) => {
      published.push({ environment, message });
      return "msg-1";
    },
  });
});

afterEach(() => {
  delete process.env.WEBHOOK_DELIVERY_URL;
  delete process.env.WEBHOOK_PUSH_SERVICE_ACCOUNT;
});

async function setup(slug = "shop") {
  const project = await admin.createProject(ORG, { slug, name: "Shop" }, actor);
  const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
  await admin.setCapability(scope, "payments", true, actor);
  const app = await admin.createApplication(scope, { slug: "worker", name: "Worker" }, actor);
  const webhook = await destinations.createWebhook(scope, { recipientApplicationId: app.id, url: URL }, actor);
  return { project, scope, app, webhook };
}

describe("webhook test events", () => {
  it("publishes a webhook.test event the destination's subscription filter selects", async () => {
    const { scope, app, webhook } = await setup();
    const result = await deliveries.sendTestEvent(scope, webhook.id, actor);

    expect(result).toMatchObject({ destinationId: webhook.id, eventType: "webhook.test", messageId: "msg-1" });
    expect(result.eventId).toMatch(/^evt_[0-9a-f]{24}$/);
    expect(published).toHaveLength(1);
    const [{ environment, message }] = published;
    expect(environment).toBe("test");
    expect(message.attributes).toMatchObject({ consumerServiceId: app.id, applicationId: app.id, eventType: "webhook.test", test: "true", eventId: result.eventId });
    expect(message.event).toMatchObject({
      eventId: result.eventId,
      contractVersion: "2.0",
      environment: "test",
      organizationId: ORG,
      projectId: scope.projectId,
      applicationId: app.id,
      aggregateType: "webhook_destination",
      aggregateId: webhook.id,
      data: expect.objectContaining({ test: true }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ type: "control_plane.event_destination.test_event_sent", resourceId: webhook.id, organizationId: ORG, projectId: scope.projectId }),
    );
  });

  it("sends at most one test event per destination every 10 seconds", async () => {
    const { scope, webhook } = await setup();
    let clock = Date.parse("2026-11-20T10:00:00Z");
    deliveries.useClock(() => clock);
    await deliveries.sendTestEvent(scope, webhook.id, actor);
    clock += 4_000;
    await expect(deliveries.sendTestEvent(scope, webhook.id, actor)).rejects.toMatchObject({ status: 429, code: "TEST_EVENT_COOLDOWN" });
    expect(published).toHaveLength(1);
    // Another destination is not held up.
    const other = await setup("other");
    await deliveries.sendTestEvent(other.scope, other.webhook.id, actor);
    clock += 6_000;
    await deliveries.sendTestEvent(scope, webhook.id, actor);
    expect(published).toHaveLength(3);
  });

  it("lets the caller retry at once when publishing failed", async () => {
    const { scope, webhook } = await setup();
    let fail = true;
    const flaky = new WebhookDeliveriesService(prisma as unknown as PrismaService, audit as unknown as AuditEventsService, history, {
      publish: async () => (fail ? Promise.reject(new Error("UNAVAILABLE")) : "msg-2"),
    });
    await expect(flaky.sendTestEvent(scope, webhook.id, actor)).rejects.toMatchObject({ status: 502 });
    fail = false;
    await expect(flaky.sendTestEvent(scope, webhook.id, actor)).resolves.toMatchObject({ messageId: "msg-2" });
  });

  it("carries the legacy resource owner, as real payment events of a migrated project do", async () => {
    const { scope, webhook } = await setup();
    prisma.cpResourceOwnerMapping.rows.push({
      organizationId: ORG,
      projectId: scope.projectId,
      environmentKind: "test",
      ownerGroupId: "legacy-tribe",
      ownerProjectId: "legacy-project",
      migrationRevision: "1",
    });
    await deliveries.sendTestEvent(scope, webhook.id, actor);
    expect(published[0].message.event).toMatchObject({ organizationId: "legacy-tribe", projectId: "legacy-project" });
  });

  it("refuses Pub/Sub push destinations, disabled webhooks and other environments", async () => {
    const { scope, app, webhook } = await setup();
    await destinations.disable(scope, webhook.id, actor);
    await expect(deliveries.sendTestEvent(scope, webhook.id, actor)).rejects.toMatchObject({ code: "DESTINATION_NOT_ACTIVE" });

    const push = await destinations.create(
      scope,
      { recipientApplicationId: app.id, pushEndpoint: "https://shop-worker-abc-uc.a.run.app/events", deliveryServiceAccountEmail: "push@shop.iam.gserviceaccount.com" },
      actor,
    );
    await expect(deliveries.sendTestEvent(scope, push.id, actor)).rejects.toMatchObject({ code: "NOT_A_WEBHOOK" });

    const other = await setup("other");
    await expect(deliveries.sendTestEvent(scope, other.webhook.id, actor)).rejects.toMatchObject({ status: 404 });
    await expect(deliveries.sendTestEvent({ ...scope, environmentKind: "live" }, webhook.id, actor)).rejects.toMatchObject({ status: 404 });
    expect(published).toHaveLength(0);
  });

  it("reports a publish failure as a bad gateway without recording an audit event", async () => {
    const { scope, webhook } = await setup();
    const failing = new WebhookDeliveriesService(prisma as unknown as PrismaService, audit as unknown as AuditEventsService, history, {
      publish: async () => Promise.reject(new Error("PERMISSION_DENIED")),
    });
    audit.record.mockClear();
    await expect(failing.sendTestEvent(scope, webhook.id, actor)).rejects.toMatchObject({ status: 502 });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("publishes onto the environment's payment events topic", async () => {
    const publishMessage = jest.fn().mockResolvedValue("m-42");
    const topic = jest.fn().mockReturnValue({ publishMessage });
    const publisher = createPubSubTestEventPublisher("gcp-project", { topic } as never);
    const message = buildTestEvent({ destinationId: "dst_abcdefghijklmnopqrstuvwx", environment: "live", organizationId: ORG, projectId: "prj_x", applicationId: "app_x" });
    await expect(publisher.publish("live", message)).resolves.toBe("m-42");
    expect(topic).toHaveBeenCalledWith("apicenter.payment-events.live");
    expect(publishMessage).toHaveBeenCalledWith({ json: message.event, attributes: message.attributes });
  });
});

describe("webhook delivery history", () => {
  const attempt: WebhookDelivery = {
    destinationId: "dst_abcdefghijklmnopqrstuvwx",
    eventId: "evt_1",
    eventType: "webhook.test",
    attempt: 1,
    outcome: "delivered",
    statusCode: 204,
    latencyMs: 87,
    error: null,
    attemptedAt: "2026-11-20T01:00:00.000Z",
  };

  it("reads the history only for a webhook in the caller's environment", async () => {
    const { scope, webhook } = await setup();
    history.list.mockResolvedValue([attempt]);
    await expect(deliveries.list(scope, webhook.id, 25)).resolves.toEqual([attempt]);
    expect(history.list).toHaveBeenCalledWith(webhook.id, 25);

    const other = await setup("other");
    history.list.mockClear();
    await expect(deliveries.list(scope, other.webhook.id, 25)).rejects.toMatchObject({ status: 404 });
    expect(history.list).not.toHaveBeenCalled();
  });

  it("calls the webhooks runtime with its admin token and a Cloud Run identity token", async () => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response(JSON.stringify({ deliveries: [attempt] }), { status: 200 }));
    const reader = createRuntimeDeliveryHistory(
      { WEBHOOK_DELIVERY_URL: "https://apicenter-webhooks-live-xyz-as.a.run.app/", WEBHOOKS_ADMIN_TOKEN: "tok" },
      fetchImpl,
      async () => "Bearer id-token",
    );
    await expect(reader.list(attempt.destinationId, 50)).resolves.toEqual([attempt]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://apicenter-webhooks-live-xyz-as.a.run.app/admin/destinations/${attempt.destinationId}/deliveries?limit=50`);
    expect(init.headers).toEqual({ "X-APICenter-Webhooks-Admin-Token": "tok", Authorization: "Bearer id-token" });
  });

  it("says when the runtime is not configured, unreachable or answers badly", async () => {
    const noAuth = async () => undefined;
    await expect(createRuntimeDeliveryHistory({}, jest.fn(), noAuth).list(attempt.destinationId, 50)).rejects.toMatchObject({ status: 503 });
    const env = { WEBHOOK_DELIVERY_URL: "https://w.example", WEBHOOKS_ADMIN_TOKEN: "tok" };
    await expect(createRuntimeDeliveryHistory(env, jest.fn().mockRejectedValue(new Error("ECONNRESET")), noAuth).list(attempt.destinationId, 50)).rejects.toMatchObject({ status: 502 });
    await expect(createRuntimeDeliveryHistory(env, jest.fn().mockResolvedValue(new Response("", { status: 401 })), noAuth).list(attempt.destinationId, 50)).rejects.toMatchObject({ status: 502 });
    await expect(
      createRuntimeDeliveryHistory(env, jest.fn().mockResolvedValue(new Response(JSON.stringify({ deliveries: [{ nope: 1 }] }), { status: 200 })), noAuth).list(attempt.destinationId, 50),
    ).rejects.toMatchObject({ status: 502 });
  });
});
