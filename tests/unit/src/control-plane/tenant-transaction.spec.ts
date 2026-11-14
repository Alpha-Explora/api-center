import { BULK_TENANT_TRANSACTION, withTenant } from "../../../../apps/gateway/src/domains/control-plane/tenant-transaction";
import { LegacyMigrationService } from "../../../../apps/gateway/src/domains/control-plane/migration/legacy-migration.service";

function fakePrisma() {
  const calls: unknown[] = [];
  const prisma: Record<string, unknown> = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(async (work: (db: unknown) => Promise<unknown>, options?: unknown): Promise<unknown> => {
      calls.push(options);
      return work(prisma);
    }),
  };
  return { prisma, calls };
}

describe("withTenant transaction limits", () => {
  const original = process.env.DATABASE_ENABLED;
  beforeAll(() => { process.env.DATABASE_ENABLED = "true"; });
  afterAll(() => { process.env.DATABASE_ENABLED = original; });

  it("keeps Prisma's defaults unless a caller asks for bulk limits", async () => {
    const { prisma, calls } = fakePrisma();
    await withTenant(prisma as never, { organizationId: "org" }, async () => "ok");
    await withTenant(prisma as never, { organizationId: "org" }, async () => "ok", BULK_TENANT_TRANSACTION);
    expect(calls).toEqual([undefined, { timeout: 120_000, maxWait: 15_000 }]);
  });

  it("runs a migration backfill with the bulk limits", async () => {
    const { prisma, calls } = fakePrisma();
    const service = new (LegacyMigrationService as unknown as new (prisma: unknown) => LegacyMigrationService)(prisma);
    jest.spyOn(service, "inventory").mockResolvedValue({ revision: "r1", plan: { blockers: [] } } as never);
    jest.spyOn(service as never, "apply").mockResolvedValue({} as never);
    jest.spyOn(service as never, "recordRun").mockResolvedValue(undefined as never);
    await service.backfill("org", "r1", "operator");
    expect(calls).toEqual([{ timeout: 120_000, maxWait: 15_000 }]);
  });
});
