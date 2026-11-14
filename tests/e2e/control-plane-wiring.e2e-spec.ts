// Boots the real gateway AppModule once: every control-plane entry point must resolve (a missing
// provider, unexported dependency or circular import fails here), and the HTTP routes must reach
// the right guards. Run without a database: application credentials then fail closed with 503.

import { Test } from "@nestjs/testing";
import { AppModule } from "../../apps/gateway/src/app.module";
import { ControlPlaneAdminController } from "../../apps/gateway/src/domains/control-plane/control-plane-admin.controller";
import { ApplicationAccessService } from "../../apps/gateway/src/domains/control-plane/application-access.service";
import { ConsoleActorGuard } from "../../apps/gateway/src/domains/control-plane/console-actor.guard";
import { EventDestinationsController } from "../../apps/gateway/src/domains/control-plane/event-destinations/event-destinations.controller";
import { PublishedApiProxyController } from "../../apps/gateway/src/domains/gateway-proxy/published-apis/published-api-proxy.controller";
import { SharedServicesController } from "../../apps/gateway/src/domains/gateway-proxy/shared-services/shared-services.controller";
import { PaymentsController } from "../../apps/gateway/src/domains/payments/features/payment-facade/payments.controller";

describe("control plane wiring", () => {
  it("resolves every control-plane entry point and routes requests to the right guards", async () => {
    delete process.env.DATABASE_URL;
    process.env.DATABASE_ENABLED = "false";
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    for (const token of [
      ControlPlaneAdminController,
      EventDestinationsController,
      PublishedApiProxyController,
      SharedServicesController,
      PaymentsController,
      ApplicationAccessService,
      ConsoleActorGuard,
    ]) {
      expect(moduleRef.get(token, { strict: false })).toBeDefined();
    }

    const app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    await app.listen(0);
    const base = await app.getUrl();
    try {
      expect((await fetch(`${base}/api/v1/admin/control-plane/capabilities`)).status).toBe(401);

      const applicationKey = await fetch(`${base}/api/v1/shared/email/send`, {
        method: "POST",
        headers: { authorization: `Bearer ak_test_aaaaaaaaaaaaaaaa_${"b".repeat(43)}`, "content-type": "application/json" },
        body: "{}",
      });
      // Reached the application path, not the legacy JWT guard, and failed closed without a database.
      expect(applicationKey.status).toBe(503);

      const legacyToken = await fetch(`${base}/api/v1/shared/email/send`, { method: "POST", headers: { authorization: "Bearer not-a-jwt" } });
      expect(legacyToken.status).toBe(401);

      expect((await fetch(`${base}/api/v1/apis/api_aaaaaaaaaaaaaaaaaaaaaaaa/orders`)).status).toBe(401);
    } finally {
      await app.close();
    }
  }, 180000);
});
