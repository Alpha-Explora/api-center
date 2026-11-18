import { TokenStoreService, RefreshTokenRecord } from "../../../../apps/gateway/src/domains/auth-security/auth/token-store.service";
import { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";
import { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";

describe("TokenStoreService", () => {
  const config = { tokenStore: { tokenTtlSeconds: 3600 } } as unknown as ConfigService;
  const logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() } as unknown as LoggerService;
  const record = (jti: string, sub = "svc-alpha"): RefreshTokenRecord => ({
    jti,
    sub,
    tribeId: "svc-alpha",
    sourceServiceId: "svc-alpha-worker",
    environment: "test",
    issuedAt: 1,
    expiresAt: 2,
    scopes: ["scope:read"],
    permissions: ["perm:read"],
  });
  const savedDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedDatabaseUrl;
    jest.useRealTimers();
  });

  describe("without a database", () => {
    let store: TokenStoreService;
    beforeEach(() => {
      delete process.env.DATABASE_URL;
      store = new TokenStoreService(config, logger);
    });

    it("stores, finds, and revokes a refresh token", async () => {
      await store.store(record("jti-1"));
      await expect(store.isValid("jti-1")).resolves.toBe(true);
      await expect(store.get("jti-1")).resolves.toMatchObject({ sub: "svc-alpha" });
      await expect(store.revoke("jti-1")).resolves.toBe(true);
      await expect(store.isValid("jti-1")).resolves.toBe(false);
      await expect(store.revoke("jti-1")).resolves.toBe(false);
    });

    it("forgets a token after its TTL", async () => {
      jest.useFakeTimers({ now: 1_000_000 });
      await store.store(record("jti-1"));
      jest.setSystemTime(1_000_000 + 3600 * 1000 + 1);
      await expect(store.isValid("jti-1")).resolves.toBe(false);
    });

    it("revokes every token of one subject only", async () => {
      await store.store(record("a-1", "svc-a"));
      await store.store(record("a-2", "svc-a"));
      await store.store(record("b-1", "svc-b"));
      await expect(store.listForSubject("svc-a")).resolves.toEqual(["a-1", "a-2"]);
      await expect(store.revokeAllForSubject("svc-a")).resolves.toBe(2);
      await expect(store.listForSubject("svc-a")).resolves.toEqual([]);
      await expect(store.isValid("b-1")).resolves.toBe(true);
    });
  });

  describe("with a database", () => {
    it("keeps metadata in apic_identity.refresh_tokens, shared by every instance", async () => {
      process.env.DATABASE_URL = "postgres://example.test/db";
      const prisma = {
        $executeRawUnsafe: jest.fn().mockResolvedValue(1),
        $queryRawUnsafe: jest.fn().mockResolvedValue([{ record: record("jti-1") }]),
      };
      const store = new TokenStoreService(config, logger, prisma as unknown as PrismaService);

      await store.store(record("jti-1"));
      const [insertSql, jti, sub, json] = prisma.$executeRawUnsafe.mock.calls[0];
      expect(insertSql).toContain("INSERT INTO apic_identity.refresh_tokens");
      expect([jti, sub, JSON.parse(json).jti]).toEqual(["jti-1", "svc-alpha", "jti-1"]);

      await expect(store.isValid("jti-1")).resolves.toBe(true);
      expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toContain("expires_at > now()");

      await expect(store.revoke("jti-1")).resolves.toBe(true);
      expect(prisma.$executeRawUnsafe.mock.calls[1]).toEqual([
        "DELETE FROM apic_identity.refresh_tokens WHERE jti = $1",
        "jti-1",
      ]);
    });
  });
});
