import { createServer, type Server } from "node:http";
import { deliver, type PushEnvelope } from "../../../../apps/webhooks/src/delivery";
import type { DestinationConfig, DestinationStore } from "../../../../apps/webhooks/src/destination-store";
import { isPrivateAddress as deliveryIsPrivate, publicOnlyLookup } from "../../../../apps/webhooks/src/public-network";
import { createHttpsSender, type Sender } from "../../../../apps/webhooks/src/send";
import { createWebhookApp } from "../../../../apps/webhooks/src/server";
import { isPrivateAddress as gatewayIsPrivate } from "../../../../apps/gateway/src/shared/proxy/upstream-guard";
import { newSigningSecret } from "../../../../apps/gateway/src/domains/control-plane/event-destinations/webhook-config-store";
import { ApiCenterWebhookError, verifyWebhook } from "../../../../packages/sdk/src";

const DESTINATION = "dst_abcdefghijklmnopqrstuvwx";
const NOW = Date.parse("2026-11-19T02:00:00Z");

const event = {
  eventId: "evt_7f3c1a",
  contractVersion: "2.0",
  eventType: "payment.checkout.paid",
  environment: "test",
  organizationId: "org-1",
  projectId: "prj_serbizio",
  applicationId: "app_serbizio",
  referenceId: "ORDER-1",
  aggregateType: "checkout",
  aggregateId: "chk_1",
  aggregateVersion: 2,
  occurredAt: "2026-11-19T01:59:58.000Z",
  data: { status: "paid", checkoutId: "chk_1", paymentId: "pay_1", amount: 39900, currency: "PHP" },
};

function push(body: unknown = event, deliveryAttempt = 1): PushEnvelope {
  return { message: { data: Buffer.from(JSON.stringify(body)).toString("base64"), messageId: "m1" }, deliveryAttempt, subscription: "s" };
}

function store(config: DestinationConfig | null): DestinationStore {
  return { get: async (id) => (id === DESTINATION ? config : null) };
}

function capture(status = 200): { send: Sender; calls: Array<{ url: string; headers: Record<string, string>; body: string }> } {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  return {
    calls,
    send: async (url, headers, body) => {
      calls.push({ url, headers, body });
      return { status, responseSnippet: "" };
    },
  };
}

describe("webhook delivery", () => {
  const secret = newSigningSecret();
  const config: DestinationConfig = { url: "https://serbizio.example/apicenter/events", secrets: [{ value: secret }] };

  it("signs the exact published body so the SDK verifies it and returns the event", async () => {
    const { send, calls } = capture(204);
    const outcome = await deliver(DESTINATION, push(event, 3), { store: store(config), send, now: () => NOW });

    expect(outcome).toEqual({ ack: true, reason: "delivered", eventId: "evt_7f3c1a", status: 204 });
    const [call] = calls;
    expect(call.url).toBe(config.url);
    expect(call.headers).toMatchObject({ "webhook-id": "evt_7f3c1a", "webhook-timestamp": String(NOW / 1000), "apicenter-delivery-attempt": "3" });
    const verified = await verifyWebhook(call.body, call.headers, secret, { now: () => NOW });
    expect(verified).toMatchObject({ eventId: "evt_7f3c1a", organizationId: "org-1", projectId: "prj_serbizio", applicationId: "app_serbizio" });
  });

  it("is rejected by the SDK when the body, secret or timestamp is wrong", async () => {
    const { send, calls } = capture();
    await deliver(DESTINATION, push(), { store: store(config), send, now: () => NOW });
    const { headers, body } = calls[0];
    const code = (pending: Promise<unknown>) => pending.then(() => "accepted", (error: unknown) => (error as ApiCenterWebhookError).code);
    expect(await code(verifyWebhook(body.replace("ORDER-1", "ORDER-2"), headers, secret, { now: () => NOW }))).toBe("WEBHOOK_SIGNATURE_INVALID");
    expect(await code(verifyWebhook(body, headers, newSigningSecret(), { now: () => NOW }))).toBe("WEBHOOK_SIGNATURE_INVALID");
    expect(await code(verifyWebhook(body, headers, secret, { now: () => NOW + 301_000 }))).toBe("WEBHOOK_TIMESTAMP_OUT_OF_RANGE");
    expect(await code(verifyWebhook(body, { "webhook-id": "x" }, secret))).toBe("WEBHOOK_HEADERS_MISSING");
    expect(await code(verifyWebhook(body, headers, "not-a-secret", { now: () => NOW }))).toBe("WEBHOOK_SECRET_INVALID");
  });

  it("signs with the new and the rotated-out secret until the old one expires", async () => {
    const next = newSigningSecret();
    const rotating: DestinationConfig = {
      url: config.url,
      secrets: [{ value: next }, { value: secret, expiresAt: new Date(NOW + 1000).toISOString() }],
    };
    const during = capture();
    await deliver(DESTINATION, push(), { store: store(rotating), send: during.send, now: () => NOW });
    expect(during.calls[0].headers["webhook-signature"].split(" ")).toHaveLength(2);
    await expect(verifyWebhook(during.calls[0].body, during.calls[0].headers, secret, { now: () => NOW })).resolves.toBeDefined();
    await expect(verifyWebhook(during.calls[0].body, during.calls[0].headers, next, { now: () => NOW })).resolves.toBeDefined();

    const after = capture();
    await deliver(DESTINATION, push(), { store: store(rotating), send: after.send, now: () => NOW + 2000 });
    expect(after.calls[0].headers["webhook-signature"].split(" ")).toHaveLength(1);
    await expect(verifyWebhook(after.calls[0].body, after.calls[0].headers, secret, { now: () => NOW + 2000 })).rejects.toBeInstanceOf(ApiCenterWebhookError);
  });

  it("acknowledges only a 2xx, so Pub/Sub retries rejections and network failures", async () => {
    expect(await deliver(DESTINATION, push(), { store: store(config), send: capture(500).send })).toMatchObject({ ack: false, reason: "rejected", status: 500 });
    expect(await deliver(DESTINATION, push(), { store: store(config), send: capture(301).send })).toMatchObject({ ack: false, reason: "rejected", status: 301 });
    const failing: Sender = async () => {
      throw new Error("Refusing to connect to non-public address for evil.example");
    };
    expect(await deliver(DESTINATION, push(), { store: store(config), send: failing })).toMatchObject({ ack: false, reason: "unreachable" });
  });

  it("drops events for a disabled destination and retries unknown ones and malformed messages", async () => {
    const { send, calls } = capture();
    expect(await deliver(DESTINATION, push(), { store: store({ ...config, disabled: true }), send })).toMatchObject({ ack: true, reason: "disabled" });
    expect(await deliver(DESTINATION, push(), { store: store(null), send })).toMatchObject({ ack: false, reason: "unknown_destination" });
    expect(await deliver("../secrets", push(), { store: store(config), send })).toMatchObject({ ack: false, reason: "unknown_destination" });
    expect(await deliver(DESTINATION, push({ no: "id" }), { store: store(config), send })).toMatchObject({ ack: false, reason: "malformed_message" });
    expect(calls).toHaveLength(0);
  });

  it("answers Pub/Sub 204 to acknowledge and 503 to retry", async () => {
    const outcomes = [200, 500];
    const app = createWebhookApp({
      store: store(config),
      send: async () => ({ status: outcomes.shift() ?? 500, responseSnippet: "" }),
    });
    const server: Server = await new Promise((resolve) => {
      const started = app.listen(0, () => resolve(started));
    });
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const { port } = server.address() as { port: number };
      const post = () => fetch(`http://127.0.0.1:${port}/deliveries/${DESTINATION}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(push()),
      });
      expect((await post()).status).toBe(204);
      expect((await post()).status).toBe(503);
      expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ type: "apicenter_webhook_delivery", destinationId: DESTINATION, reason: "delivered" });
    } finally {
      log.mockRestore();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

describe("webhook network guard", () => {
  it("blocks the same address ranges as the gateway's upstream guard", () => {
    const samples = [
      "8.8.8.8", "1.1.1.1", "10.1.2.3", "127.0.0.1", "100.64.0.1", "169.254.169.254", "172.16.0.1", "172.32.0.1",
      "192.168.1.1", "192.0.0.8", "198.18.0.1", "224.0.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1",
      "::ffff:10.0.0.1", "::ffff:8.8.8.8", "64:ff9b::1", "2001:db8::1", "2606:4700::1111",
    ];
    for (const address of samples) expect([address, deliveryIsPrivate(address)]).toEqual([address, gatewayIsPrivate(address)]);
  });

  it("refuses to connect when a host resolves to a private address", async () => {
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => publicOnlyLookup("localhost", {}, (err) => resolve(err)));
    expect(error?.code).toBe("EADDRNOTPUBLIC");
  });

  it("sends only to https URLs", async () => {
    await expect(createHttpsSender()("http://example.test/hook", {}, "{}")).rejects.toThrow("https");
  });

  it("does not reach a server on this machine even over https", async () => {
    const local = createServer((_req, res) => res.end("reached"));
    await new Promise<void>((resolve) => local.listen(0, resolve));
    try {
      const { port } = local.address() as { port: number };
      await expect(createHttpsSender({ timeoutMs: 2000 })(`https://localhost:${port}/hook`, {}, "{}")).rejects.toMatchObject({ code: "EADDRNOTPUBLIC" });
    } finally {
      await new Promise((resolve) => local.close(resolve));
    }
  });
});
