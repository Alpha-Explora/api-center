import { FeatureRequestService } from "../../../../../apps/gateway/src/domains/control-plane/features/feature-request.service";
import { FeatureRequestsController } from "../../../../../apps/gateway/src/domains/control-plane/features/feature-requests.controller";

const organizationId = "9cb3f8a4-0a56-4c61-a087-6abd02a9e1f0";
const projectId = "prj_aaaaaaaaaaaaaaaaaaaaaaaa";

describe("feature access by environment", () => {
  it("refuses requests for payout features that are self-service in test, before touching storage", async () => {
    const prisma = { $transaction: jest.fn() };
    const service = new FeatureRequestService(prisma as never, { record: jest.fn() } as never);
    for (const feature of ["payouts.sending", "payouts.merchant_account", "payouts.payee_wallets", "sms.sender"] as const) {
      await expect(service.create({ organizationId, projectId, environmentKind: "test" }, { feature, change: {}, reason: "Try it" },
        "dev@example.test")).rejects.toMatchObject({ code: "FEATURE_NOT_AVAILABLE" });
    }
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lists payout features as usable in test and not yet requestable in live", async () => {
    const controller = new FeatureRequestsController(
      { require: jest.fn().mockResolvedValue({}) } as never,
      { listForEnvironment: jest.fn().mockResolvedValue([]) } as never,
      {} as never,
      { call: jest.fn().mockResolvedValue({ data: [] }) } as never,
    );
    const req = { consoleActor: { kind: "member", email: "dev@example.test", subject: "s", platformAdmin: false } } as never;
    const views = async (environment: "test" | "live") => Object.fromEntries(
      (await controller.list({ organizationId, projectId, environment }, req)).data.map((view) => [view.key, view]));

    const test = await views("test");
    const live = await views("live");
    for (const key of ["payouts.sending", "payouts.merchant_account"]) {
      expect(test[key]).toMatchObject({ release: "available", offered: true, requestable: false });
      expect(live[key]).toMatchObject({ release: "coming_soon", offered: true, requestable: false });
    }
    expect(test["payouts.payee_wallets"]).toMatchObject({ release: "pilot", requestable: false });
    expect(live["payments.live"]).toMatchObject({ release: "available", requestable: true });
    expect(test["plan.upgrade"]).toMatchObject({ requestable: true });
  });
});
