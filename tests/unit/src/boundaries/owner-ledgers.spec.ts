import { Test } from "@nestjs/testing";
import { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import { QuotaLedgerModule } from "../../../../apps/gateway/src/domains/runtime-ops/quota-ledger/quota-ledger.module";
import { QUOTA_EVALUATION_LEDGER } from "../../../../apps/gateway/src/domains/runtime-ops/quota-ledger/quota-evaluation-ledger.types";
import { RegistryChangeRequestModule } from "../../../../apps/gateway/src/domains/governance/change-requests/registry-change-request.module";
import { REGISTRY_CHANGE_REQUEST_STORE } from "../../../../apps/gateway/src/domains/governance/change-requests/registry-change-request.types";

describe("owner ledgers", () => {
  const prisma = {
    quotaEvaluation: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    registryChangeRequest: {
      create: jest.fn(), findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn(),
      update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  async function compile() {
    const moduleRef = await Test.createTestingModule({ imports: [QuotaLedgerModule, RegistryChangeRequestModule] })
      .overrideProvider(PrismaService).useValue(prisma)
      .compile();
    return moduleRef;
  }

  it("writes quota evaluations through the runtime-owned ledger", async () => {
    const ledger = (await compile()).get(QUOTA_EVALUATION_LEDGER);
    const entry = { ownerTribeId: "t", scope: "all", routeFamily: "r", windowStart: new Date(), windowEnd: new Date(),
      requestCount: 1, maxRequests: 2, mode: "enforce", outcome: "allowed" };
    await ledger.record(entry);
    expect(prisma.quotaEvaluation.create).toHaveBeenCalledWith({ data: entry });

    const since = new Date("2026-01-01T00:00:00Z");
    await ledger.listSince({ ownerTribeId: "t", since, limit: 5 });
    expect(prisma.quotaEvaluation.findMany).toHaveBeenCalledWith({
      where: { ownerTribeId: "t", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 5,
    });
  });

  it("stores change requests through the governance-owned store", async () => {
    const store = (await compile()).get(REGISTRY_CHANGE_REQUEST_STORE);
    await store.rejectIfPending("id-1", { rejectedBy: "admin", reason: "no" });
    expect(prisma.registryChangeRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "id-1", status: "pending" },
      data: expect.objectContaining({ status: "rejected", rejectedBy: "admin", rejectionReason: "no" }),
    });
    await expect(store.rejectIfPending("id-1", { rejectedBy: "admin", reason: "no" })).resolves.toBe(false);

    await store.markApplied("id-1", { approvedBy: "admin", appliedServiceId: "svc", validationReport: { canApply: true } });
    expect(prisma.registryChangeRequest.update).toHaveBeenCalledWith({
      where: { id: "id-1" },
      data: expect.objectContaining({ status: "applied", approvedBy: "admin", appliedServiceId: "svc" }),
    });
  });
});
