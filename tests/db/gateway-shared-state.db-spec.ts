// Runs the gateway's payment idempotency through the real PrismaService, as the gateway's api_center_app role, against a database built by
// "npm run db:verify:replay".
//
//   DATABASE_URL=postgres://... npm run db:test:shared-state
import { Client } from "pg";
import { PrismaService } from "../../apps/gateway/src/database/prisma.service";
import { PaymentIdempotencyService } from "../../apps/gateway/src/domains/payments/shared/payment-idempotency.service";

const adminUrl = process.env.DATABASE_URL;
const describeWithDatabase = adminUrl ? describe : describe.skip;

describeWithDatabase("gateway shared state in Postgres", () => {
  let admin: Client;
  let prisma: PrismaService;

  beforeAll(async () => {
    admin = new Client({ connectionString: adminUrl });
    await admin.connect();
    const appUrl = new URL(adminUrl!);
    appUrl.searchParams.set("options", "-c role=api_center_app");
    process.env.DATABASE_URL = appUrl.toString();
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    process.env.DATABASE_URL = adminUrl;
    await prisma?.onModuleDestroy();
    await admin?.end();
  });

  beforeEach(async () => {
    await admin.query("truncate apic_governance.payment_idempotency_keys");
  });

  describe("payment idempotency", () => {
    const principal = { ownerTribeId: "org", projectId: "prj", consumerServiceId: "svc", environment: "test" as const };
    const request = { principal, method: "POST", path: "/payments/checkouts", key: "checkout-key-0000001", body: { amountMinor: 2000 } };
    const response = { status: 201, contentType: "application/json", body: '{"checkoutId":"chk_1"}' };

    it("reserves once across instances, then replays the stored response", async () => {
      const first = new PaymentIdempotencyService(prisma);
      const second = new PaymentIdempotencyService(prisma);

      await expect(first.lookupOrValidate(request)).resolves.toEqual({ miss: true });
      await expect(second.lookupOrValidate(request)).rejects.toMatchObject({ response: { code: "IDEMPOTENCY_KEY_IN_PROGRESS" } });
      await expect(second.lookupOrValidate({ ...request, body: { amountMinor: 1 } }))
        .rejects.toMatchObject({ response: { code: "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" } });

      await first.store({ ...request, response });
      await expect(second.lookupOrValidate(request)).resolves.toEqual({ replay: response });
    });

    it("lets a retry take over an expired lease, and keeps an unknown outcome without expiry", async () => {
      const service = new PaymentIdempotencyService(prisma);
      await service.lookupOrValidate(request);
      await service.markUnknown(request);
      const { rows } = await admin.query(
        "select unknown_since is not null as unknown, expires_at, response from apic_governance.payment_idempotency_keys",
      );
      expect(rows).toEqual([{ unknown: true, expires_at: null, response: null }]);

      await admin.query("update apic_governance.payment_idempotency_keys set lease_until = now() - interval '1 second'");
      await expect(service.lookupOrValidate(request)).resolves.toEqual({ miss: true });
    });

    it("refuses automatic retries once the provider's idempotency window has passed", async () => {
      const service = new PaymentIdempotencyService(prisma);
      await service.lookupOrValidate(request);
      await admin.query(
        "update apic_governance.payment_idempotency_keys set created_at = now() - interval '24 hours', lease_until = null",
      );
      await expect(service.lookupOrValidate(request)).rejects.toMatchObject({ response: { code: "PAYMENT_OUTCOME_UNKNOWN" } });
    });

    it("can reuse a key only after its replay record expires", async () => {
      const service = new PaymentIdempotencyService(prisma);
      await service.lookupOrValidate(request);
      await service.store({ ...request, response });
      await admin.query("update apic_governance.payment_idempotency_keys set expires_at = now() - interval '1 second'");
      await expect(service.lookupOrValidate({ ...request, body: { amountMinor: 5000 } })).resolves.toEqual({ miss: true });
    });
  });
});
