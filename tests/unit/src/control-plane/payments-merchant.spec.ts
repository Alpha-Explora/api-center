import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import { ConsoleAccessService } from "../../../../apps/gateway/src/domains/control-plane/console-access.service";
import type { ConsoleRequest } from "../../../../apps/gateway/src/domains/control-plane/console-actor.guard";
import type { ConsoleActor } from "../../../../apps/gateway/src/domains/control-plane/console-access.policy";
import { merchantBindingStatus } from "../../../../apps/gateway/src/domains/control-plane/merchant-binding";
import { PaymentsMerchantController } from "../../../../apps/gateway/src/domains/control-plane/payments-merchant.controller";
import { createFakeControlPlanePrisma } from "./fake-control-plane-prisma";

const MERCHANT_ORG = "6f1c1d1e-0000-4000-8000-0000000000d1";
const OTHER_ORG = "6f1c1d1e-0000-4000-8000-0000000000d2";
const viewer: ConsoleActor = { kind: "member", email: "viewer@example.test", subject: "sub-viewer", platformAdmin: false };
const stranger: ConsoleActor = { kind: "member", email: "stranger@example.test", subject: "sub-stranger", platformAdmin: false };
const req = (actor: ConsoleActor) => ({ consoleActor: actor }) as ConsoleRequest;

describe("payments merchant binding status", () => {
  it("reports bound only for organizations listed in PAYMENTS_MERCHANT_ORGANIZATION_IDS", () => {
    const env = { PAYMENTS_MERCHANT_ORGANIZATION_IDS: ` ${MERCHANT_ORG.toUpperCase()} , other ` };
    expect(merchantBindingStatus(MERCHANT_ORG, env)).toEqual({ organizationId: MERCHANT_ORG, bound: true, reason: null });
    expect(merchantBindingStatus(OTHER_ORG, env)).toMatchObject({ bound: false, reason: expect.stringContaining("merchant binding") });
    expect(merchantBindingStatus(MERCHANT_ORG, {}).bound).toBe(false);
  });

  describe("GET organizations/:organizationId/payments/merchant-binding", () => {
    let controller: PaymentsMerchantController;

    beforeEach(() => {
      process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/apicenter_test";
      process.env.PAYMENTS_MERCHANT_ORGANIZATION_IDS = MERCHANT_ORG;
      const prisma = createFakeControlPlanePrisma();
      prisma.organization.rows.push({ id: MERCHANT_ORG, status: "active" }, { id: OTHER_ORG, status: "active" });
      for (const organizationId of [MERCHANT_ORG, OTHER_ORG]) {
        prisma.organizationMember.rows.push({ organizationId, email: "viewer@example.test", role: "viewer", status: "active", subject: null });
      }
      controller = new PaymentsMerchantController(new ConsoleAccessService(prisma as unknown as PrismaService));
    });

    afterEach(() => {
      delete process.env.PAYMENTS_MERCHANT_ORGANIZATION_IDS;
    });

    it("answers any member of the organization", async () => {
      await expect(controller.merchantBinding(MERCHANT_ORG, req(viewer))).resolves.toMatchObject({ data: { bound: true } });
      await expect(controller.merchantBinding(OTHER_ORG, req(viewer))).resolves.toMatchObject({ data: { bound: false } });
    });

    it("hides the organization from non-members and rejects malformed ids", async () => {
      await expect(controller.merchantBinding(MERCHANT_ORG, req(stranger))).rejects.toMatchObject({ status: 404 });
      await expect(controller.merchantBinding("not-a-uuid", req(viewer))).rejects.toMatchObject({ status: 400 });
    });
  });
});
