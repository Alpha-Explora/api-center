import type { INestApplication, Type } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { MODULE_METADATA } from "@nestjs/common/constants";
import { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import { SharedServicesModule } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/shared-services.module";
import { SharedServiceRoutingService } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/shared-service-routing.service";
import { ApplicationCapabilityProxy } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/application-capability-proxy";

// Boots the module's real controller list in its real order. Express matches routes in
// registration order, so a catch-all listed ahead of a provider callback takes its requests:
// PayMongo's live webhooks got "An application key is required" on 2026-11-21.
describe("shared services routing", () => {
  let app: INestApplication;
  let base: string;
  const capabilityForward = jest.fn(
    async (_capability: string, _bearer: string, _req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) => {
      res.status(200).json({ proxied: true });
    },
  );

  beforeAll(async () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, SharedServicesModule) as Type[];
    const module = await Test.createTestingModule({
      controllers,
      providers: [
        { provide: ConfigService, useValue: { paymentWebhooks: { paymongoTestSecret: "test-key", paymongoLiveSecret: "live-key" } } },
        { provide: AuditEventsService, useValue: { record: jest.fn() } },
        { provide: SharedServiceRoutingService, useValue: { resolve: jest.fn() } },
        { provide: ApplicationCapabilityProxy, useValue: { forward: capabilityForward } },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => capabilityForward.mockClear());

  it.each(["live", "test"])("lets the PayMongo webhook controller judge %s webhooks, which carry no application key", async (environment) => {
    const response = await fetch(`${base}/shared/payment/webhooks/${environment}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Paymongo-Signature": "t=1,te=00,li=00" },
      body: JSON.stringify({ data: { id: "evt_1" } }),
    });

    expect(await response.json()).toMatchObject({ message: "Invalid PayMongo webhook signature" });
    expect(capabilityForward).not.toHaveBeenCalled();
  });

  it("still sends other payment calls to the capability proxy", async () => {
    const response = await fetch(`${base}/shared/payment/payment-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ak_test_fixture" },
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(capabilityForward).toHaveBeenCalledWith("payment", "ak_test_fixture", expect.anything(), expect.anything());
  });
});
