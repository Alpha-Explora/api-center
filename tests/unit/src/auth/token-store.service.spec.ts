import { TokenStoreService, RefreshTokenRecord } from "../../../../apps/gateway/src/auth/token-store.service";
import { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";

describe("TokenStoreService", () => {
  const mockConfig = {
    redis: {
      cacheUrl: "redis://localhost:6379",
      tokenTtlSeconds: 3600,
      sessionTtlSeconds: 7200,
    },
  } as unknown as ConfigService;

  const mockLogger = {
    log: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  } as unknown as LoggerService;

  let service: TokenStoreService;

  const sampleRecord: RefreshTokenRecord = {
    jti: "jti-1",
    sub: "svc-alpha",
    tribeId: "svc-alpha",
    sourceServiceId: "svc-alpha-worker",
    environment: "test",
    issuedAt: 1,
    expiresAt: 2,
    scopes: ["scope:read"],
    permissions: ["perm:read"],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TokenStoreService(mockConfig, mockLogger);
  });

  it("should fail closed when Redis is unavailable during validity checks", async () => {
    await expect(service.isValid("missing-jti")).resolves.toBe(false);
  });

  it("should log Redis fallback warning only once while Redis remains unavailable", async () => {
    await service.isValid("jti-a");
    await service.isValid("jti-b");

    expect((mockLogger.warn as jest.Mock).mock.calls.length).toBe(1);
  });

  it("should report Redis connectivity when status is ready", () => {
    (service as any).redis = { status: "ready" };

    expect(service.isRedisConnected()).toBe(true);
  });

  it("should persist refresh record and update session index", async () => {
    const redis = {
      setex: jest.fn().mockResolvedValue("OK"),
      sadd: jest.fn().mockResolvedValue(1),
      ttl: jest.fn().mockResolvedValue(0),
      expire: jest.fn().mockResolvedValue(1),
    };
    (service as any).redis = redis;

    await service.store(sampleRecord);

    expect(redis.setex).toHaveBeenCalledWith(
      "refresh:jti-1",
      3600,
      JSON.stringify(sampleRecord),
    );
    expect(redis.sadd).toHaveBeenCalledWith("session:svc-alpha", "jti-1");
    expect(redis.expire).toHaveBeenCalledWith("session:svc-alpha", 7200);
  });

  it("should revoke a token and remove it from the subject session index", async () => {
    const redis = {
      get: jest.fn().mockResolvedValue(JSON.stringify(sampleRecord)),
      del: jest.fn().mockResolvedValue(1),
      srem: jest.fn().mockResolvedValue(1),
    };
    (service as any).redis = redis;

    await expect(service.revoke("jti-1")).resolves.toBe(true);
    expect(redis.srem).toHaveBeenCalledWith("session:svc-alpha", "jti-1");
  });
});
