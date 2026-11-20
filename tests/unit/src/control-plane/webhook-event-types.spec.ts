// Event-type filters on webhook destinations: the gateway validates and stores them in the
// destination's config, and the delivery service drops events of other types.
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import type { PaymentPubSubProvisioningService } from "../../../../apps/gateway/src/domains/payments/features/pubsub-provisioning/payment-pubsub-provisioning.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ConsoleAccessService } from "../../../../apps/gateway/src/domains/control-plane/console-access.service";
import { EventDestinationService } from "../../../../apps/gateway/src/domains/control-plane/event-destinations/event-destination.service";
import { EventDestinationsController } from "../../../../apps/gateway/src/domains/control-plane/event-destinations/event-destinations.controller";
import { normalizeEventTypes, PAYMENT_EVENT_TYPES } from "../../../../apps/gateway/src/domains/control-plane/event-destinations/event-types";
import { createMemoryWebhookConfigStore } from "../../../../apps/gateway/src/domains/control-plane/event-destinations/webhook-config-store";
import type { ConsoleActor } from "../../../../apps/gateway/src/domains/control-plane/console-access.policy";
import type { ConsoleRequest } from "../../../../apps/gateway/src/domains/control-plane/console-actor.guard";
import { deliver } from "../../../../apps/webhooks/src/delivery";
import { deliversEventType } from "../../../../apps/webhooks/src/event-filter";
import type { DestinationConfig } from "../../../../apps/webhooks/src/destination-store";
import asyncApi from "../../../../packages/contracts/apicenter-asyncapi.json";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-000000000601";
const actor = "admin@example.test";
const URL = "https://8.8.8.8/apicenter/events";
const platform: ConsoleActor = { kind: "platform", id: "platform" };

describe("event-type catalogue", () => {
  it("matches the messages of the published AsyncAPI contract", () => {
    const published = Object.values((asyncApi as { components: { messages: Record<string, { name: string; title: string }> } }).components.messages);
    expect(PAYMENT_EVENT_TYPES.map((definition) => [definition.type, definition.title])).toEqual(published.map((message) => [message.name, message.title]));
  });

  it("normalizes a selection to catalogue order without duplicates, and rejects unknown types", () => {
    expect(normalizeEventTypes(["payment.intent.failed", "payment.checkout.paid", "payment.intent.failed"])).toEqual(["payment.checkout.paid", "payment.intent.failed"]);
    expect(normalizeEventTypes([])).toEqual([]);
    expect(() => normalizeEventTypes(["payment.refund.created", "x"])).toThrow("Unknown event type(s): payment.refund.created, x");
  });
});

describe("webhook event-type filters in the gateway", () => {
  let prisma: FakeControlPlanePrisma;
  let admin: ControlPlaneAdminService;
  let destinations: EventDestinationService;
  let configs: ReturnType<typeof createMemoryWebhookConfigStore>;
  let audit: { record: jest.Mock };

  beforeEach(() => {
    process.env.DATABASE_ENABLED = "true";
    process.env.PAYMENTS_MERCHANT_ORGANIZATION_IDS = ORG;
    process.env.WEBHOOK_DELIVERY_URL = "https://apicenter-webhooks-xyz-as.a.run.app";
    process.env.WEBHOOK_PUSH_SERVICE_ACCOUNT = "push@apicenter.iam.gserviceaccount.com";
    prisma = createFakeControlPlanePrisma();
    prisma.organization.rows.push({ id: ORG, status: "active" });
    prisma.organizationMember.rows.push({ organizationId: ORG, email: "dev@example.test", role: "developer", status: "active", subject: null });
    const db = prisma as unknown as PrismaService;
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    admin = new ControlPlaneAdminService(db, audit as unknown as AuditEventsService);
    configs = createMemoryWebhookConfigStore();
    const provisioner = { provision: jest.fn().mockResolvedValue({ subscriptionName: "apicenter.payment-events.test.app_x" }) };
    destinations = new EventDestinationService(db, provisioner as unknown as PaymentPubSubProvisioningService, audit as unknown as AuditEventsService, configs);
  });

  afterEach(() => {
    delete process.env.WEBHOOK_DELIVERY_URL;
    delete process.env.WEBHOOK_PUSH_SERVICE_ACCOUNT;
  });

  async function setup() {
    const project = await admin.createProject(ORG, { slug: "shop", name: "Shop" }, actor);
    const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
    await admin.setCapability(scope, "payments", true, actor);
    const app = await admin.createApplication(scope, { slug: "worker", name: "Worker" }, actor);
    return { project, scope, app };
  }

  it("stores a chosen filter on the row and in the delivery config; no filter leaves the config unfiltered", async () => {
    const { scope, app } = await setup();
    const filtered = await destinations.createWebhook(scope, { recipientApplicationId: app.id, url: URL, eventTypes: ["payment.intent.failed"] }, actor);
    expect(filtered.eventTypes).toEqual(["payment.intent.failed"]);
    expect(await configs.read(filtered.id)).toMatchObject({ eventTypes: ["payment.intent.failed"] });

    const other = await admin.createApplication(scope, { slug: "other", name: "Other" }, actor);
    const all = await destinations.createWebhook(scope, { recipientApplicationId: other.id, url: URL }, actor);
    expect(all.eventTypes).toEqual([]);
    expect(await configs.read(all.id)).not.toHaveProperty("eventTypes");
  });

  it("refuses unknown types before creating anything", async () => {
    const { scope, app } = await setup();
    await expect(destinations.createWebhook(scope, { recipientApplicationId: app.id, url: URL, eventTypes: ["payment.made.up"] }, actor)).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma.cpEventDestination.rows).toHaveLength(0);
  });

  it("edits the filter, keeps the signing secrets, survives rotation, and audits before and after", async () => {
    const { scope, app } = await setup();
    const created = await destinations.createWebhook(scope, { recipientApplicationId: app.id, url: URL }, actor);
    const updated = await destinations.setEventTypes(scope, created.id, ["payment.intent.paid", "payment.checkout.paid"], actor);
    expect(updated.eventTypes).toEqual(["payment.checkout.paid", "payment.intent.paid"]);
    expect(await configs.read(created.id)).toEqual({
      url: URL,
      secrets: [{ value: created.signingSecret }],
      eventTypes: ["payment.checkout.paid", "payment.intent.paid"],
    });
    await destinations.rotateSecret(scope, created.id, actor);
    expect((await configs.read(created.id))?.eventTypes).toEqual(["payment.checkout.paid", "payment.intent.paid"]);

    await destinations.setEventTypes(scope, created.id, [], actor);
    expect(await configs.read(created.id)).not.toHaveProperty("eventTypes");
    const event = audit.record.mock.calls.map(([record]) => record).filter((record) => record.type === "control_plane.event_destination.event_types_changed")[0];
    expect(event?.payload).toEqual({ before: [], after: ["payment.checkout.paid", "payment.intent.paid"] });
  });

  it("refuses to filter a Pub/Sub push destination or a disabled webhook", async () => {
    const { scope, app } = await setup();
    const push = await destinations.create(
      scope,
      { recipientApplicationId: app.id, pushEndpoint: "https://shop-worker-abc-uc.a.run.app/events", deliveryServiceAccountEmail: "p@shop.iam.gserviceaccount.com" },
      actor,
    );
    await expect(destinations.setEventTypes(scope, push.id, ["payment.intent.paid"], actor)).rejects.toMatchObject({ code: "EVENT_FILTER_UNSUPPORTED" });

    const other = await admin.createApplication(scope, { slug: "other", name: "Other" }, actor);
    const webhook = await destinations.createWebhook(scope, { recipientApplicationId: other.id, url: URL }, actor);
    await destinations.disable(scope, webhook.id, actor);
    await expect(destinations.setEventTypes(scope, webhook.id, ["payment.intent.paid"], actor)).rejects.toMatchObject({ status: 409 });
  });

  it("serves the catalogue and the edit route under console authorization", async () => {
    const { scope, app, project } = await setup();
    const created = await destinations.createWebhook(scope, { recipientApplicationId: app.id, url: URL }, actor);
    const controller = new EventDestinationsController(destinations, new ConsoleAccessService(prisma as unknown as PrismaService));
    const req = (who: ConsoleActor) => ({ consoleActor: who }) as ConsoleRequest;
    const params = { organizationId: ORG, projectId: project.id, environment: "test", destinationId: created.id };

    await expect(controller.eventTypes(ORG, req(platform))).resolves.toEqual({ success: true, data: PAYMENT_EVENT_TYPES });
    await expect(controller.setEventTypes(params, { eventTypes: "payment.intent.paid" }, req(platform))).rejects.toMatchObject({ status: 400 });
    await expect(controller.setEventTypes(params, { eventTypes: ["payment.intent.paid"], extra: 1 }, req(platform))).rejects.toMatchObject({ status: 400 });
    // A developer without a role on the project cannot see it.
    const dev: ConsoleActor = { kind: "member", email: "dev@example.test", subject: "s", platformAdmin: false };
    await expect(controller.setEventTypes(params, { eventTypes: [] }, req(dev))).rejects.toMatchObject({ status: 404 });
    await expect(controller.setEventTypes(params, { eventTypes: ["payment.intent.paid"] }, req(platform))).resolves.toMatchObject({
      data: { eventTypes: ["payment.intent.paid"] },
    });
  });
});

describe("event-type filters in the delivery service", () => {
  const DESTINATION = "dst_abcdefghijklmnopqrstuvwx";
  const body = (eventType: string) => JSON.stringify({ eventId: `evt_${eventType}`, eventType });
  const push = (eventType: string) => ({ message: { data: Buffer.from(body(eventType)).toString("base64") }, deliveryAttempt: 1 });

  function harness(config: DestinationConfig) {
    const sent: string[] = [];
    const deps = {
      store: { get: async () => config },
      send: async (_url: string, _headers: Record<string, string>, payload: string) => {
        sent.push(JSON.parse(payload).eventType);
        return { status: 200, responseSnippet: "" };
      },
    };
    return { sent, run: (eventType: string) => deliver(DESTINATION, push(eventType), deps) };
  }

  it("delivers only chosen types and acknowledges the rest without calling the endpoint", async () => {
    const { sent, run } = harness({ url: URL, secrets: [{ value: "whsec_x" }], eventTypes: ["payment.intent.failed"] });
    await expect(run("payment.intent.paid")).resolves.toEqual({ ack: true, reason: "filtered", eventId: "evt_payment.intent.paid" });
    await expect(run("payment.intent.failed")).resolves.toMatchObject({ ack: true, reason: "delivered" });
    expect(sent).toEqual(["payment.intent.failed"]);
  });

  it("always delivers the console's test event", async () => {
    const { sent, run } = harness({ url: URL, secrets: [{ value: "whsec_x" }], eventTypes: ["payment.intent.failed"] });
    await expect(run("webhook.test")).resolves.toMatchObject({ reason: "delivered" });
    expect(sent).toEqual(["webhook.test"]);
  });

  it("drops a filtered event even when no signing secret is active", async () => {
    const { run } = harness({ url: URL, secrets: [], eventTypes: ["payment.intent.failed"] });
    await expect(run("payment.checkout.paid")).resolves.toMatchObject({ ack: true, reason: "filtered" });
  });

  it("delivers everything without a filter, and lets delivery report malformed bodies", () => {
    expect(deliversEventType({}, body("payment.checkout.paid"))).toBe(true);
    expect(deliversEventType({ eventTypes: [] }, body("anything"))).toBe(true);
    expect(deliversEventType({ eventTypes: ["payment.intent.paid"] }, "not json")).toBe(true);
    expect(deliversEventType({ eventTypes: ["payment.intent.paid"] }, JSON.stringify({ eventId: "e" }))).toBe(true);
  });
});
