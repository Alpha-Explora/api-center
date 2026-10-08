import crypto from "node:crypto";
import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";
import {
  SecretManagerClientLike,
  ServiceSecretResolverService,
} from "../../../../apps/gateway/src/domains/catalog-registry/registry/service-secret-resolver.service";

const mockLogger: Partial<LoggerService> = {
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

const hashSecret = (secret: string) =>
  crypto.createHash("sha256").update(secret).digest("hex");

const legacyPerTribeSecretKey = ["TRIBE", "SECRET", "SMOKE", "TRIBE"].join(
  "_",
);

const secretResponse = (payload: string) =>
  Promise.resolve([
    {
      payload: {
        data: Buffer.from(payload, "utf8"),
      },
    },
  ]);

describe("ServiceSecretResolverService", () => {
  const originalEnv = process.env;
  let accessSecretVersion: jest.Mock;
  let service: ServiceSecretResolverService;

  beforeEach(() => {
    jest.useRealTimers();
    process.env = { ...originalEnv };
    delete process.env[legacyPerTribeSecretKey];
    delete process.env.TRIBE_SECRET_SOURCE;
    delete process.env.TRIBE_SECRET_GCP_PREFIX;
    delete process.env.TRIBE_SECRET_CACHE_TTL_SECONDS;
    delete process.env.GCP_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    jest.clearAllMocks();
    accessSecretVersion = jest.fn();
    service = new ServiceSecretResolverService(
      mockLogger as LoggerService,
      {
        accessSecretVersion,
      } as SecretManagerClientLike,
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });


  it("reads and caches separate environment-scoped Secret Manager resources", async () => {
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    process.env.GCP_PROJECT_ID = "api-center-test";
    const testHash = hashSecret("test-secret");
    const liveHash = hashSecret("live-secret");
    accessSecretVersion
      .mockReturnValueOnce(
        secretResponse(
          JSON.stringify({
            serviceId: "church-donations",
            environment: "test",
            secretHashSha256: testHash,
            status: "active",
          }),
        ),
      )
      .mockReturnValueOnce(
        secretResponse(
          JSON.stringify({
            serviceId: "church-donations",
            environment: "live",
            secretHashSha256: liveHash,
            status: "active",
          }),
        ),
      );

    await expect(
      service.validateEnvironmentSecret("church-donations", "test-secret", "test"),
    ).resolves.toBe(true);
    await expect(
      service.validateEnvironmentSecret("church-donations", "live-secret", "live"),
    ).resolves.toBe(true);
    await expect(
      service.validateEnvironmentSecret("church-donations", "test-secret", "test"),
    ).resolves.toBe(true);

    expect(accessSecretVersion).toHaveBeenCalledTimes(2);
    expect(accessSecretVersion).toHaveBeenNthCalledWith(1, {
      name: "projects/api-center-test/secrets/api-center-service-secret-church-donations-test/versions/latest",
    });
    expect(accessSecretVersion).toHaveBeenNthCalledWith(2, {
      name: "projects/api-center-test/secrets/api-center-service-secret-church-donations-live/versions/latest",
    });
  });

  it("rejects an environment-scoped payload for a different runtime environment", async () => {
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    process.env.GCP_PROJECT_ID = "api-center-test";
    accessSecretVersion.mockReturnValueOnce(
      secretResponse(
        JSON.stringify({
          serviceId: "church-donations",
          environment: "live",
          secretHashSha256: hashSecret("live-secret"),
          status: "active",
        }),
      ),
    );

    await expect(
      service.validateEnvironmentSecret("church-donations", "live-secret", "test"),
    ).resolves.toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("environment 'live' does not match 'test'"),
      "ServiceSecretResolverService",
    );
  });

  it("does not fall back to legacy env vars for environment-scoped validation", async () => {
    process.env[legacyPerTribeSecretKey] = hashSecret("plain-secret");

    await expect(
      service.validateEnvironmentSecret("smoke-service", "plain-secret", "test"),
    ).resolves.toBe(false);
    expect(accessSecretVersion).not.toHaveBeenCalled();
  });
  it("validates an environment-scoped GCP Secret Manager JSON payload", async () => {
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    process.env.GCP_PROJECT_ID = "api-center-test";
    const hash = hashSecret("plain-secret");
    accessSecretVersion.mockReturnValueOnce(
      secretResponse(
        JSON.stringify({
          serviceId: "smoke-service",
          environment: "test",
          secretHashSha256: hash,
          status: "active",
        }),
      ),
    );

    await expect(
      service.validateEnvironmentSecret("smoke-service", "plain-secret", "test"),
    ).resolves.toBe(true);
    expect(accessSecretVersion).toHaveBeenCalledWith({
      name: "projects/api-center-test/secrets/api-center-service-secret-smoke-service-test/versions/latest",
    });
  });

  it("rejects a payload that names a different service, such as a sibling or the old tribe secret", async () => {
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    process.env.GCP_PROJECT_ID = "api-center-test";
    accessSecretVersion.mockReturnValueOnce(
      secretResponse(
        JSON.stringify({
          serviceId: "smoke-sibling",
          environment: "test",
          secretHashSha256: hashSecret("plain-secret"),
          status: "active",
        }),
      ),
    );

    await expect(
      service.validateEnvironmentSecret("smoke-service", "plain-secret", "test"),
    ).resolves.toBe(false);
  });

  it("accepts current and next hashes while a rotation is dual-valid", async () => {
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    process.env.GCP_PROJECT_ID = "api-center-test";
    const currentHash = hashSecret("current-secret");
    const nextHash = hashSecret("next-secret");
    accessSecretVersion.mockReturnValueOnce(
      secretResponse(
        JSON.stringify({
          serviceId: "smoke-service",
          environment: "test",
          secretHashSha256: currentHash,
          nextSecretHashSha256: nextHash,
          status: "active",
          rotationState: "active_dual_valid",
        }),
      ),
    );

    await expect(
      service.validateEnvironmentSecret("smoke-service", "current-secret", "test"),
    ).resolves.toBe(true);
    await expect(
      service.validateEnvironmentSecret("smoke-service", "next-secret", "test"),
    ).resolves.toBe(true);
    await expect(
      service.validateEnvironmentSecret("smoke-service", "wrong-secret", "test"),
    ).resolves.toBe(false);
  });

  it("accepts only the promoted hash after the old secret is revoked", async () => {
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    process.env.GCP_PROJECT_ID = "api-center-test";
    const promotedHash = hashSecret("new-secret");
    accessSecretVersion.mockReturnValueOnce(
      secretResponse(
        JSON.stringify({
          serviceId: "smoke-service",
          environment: "test",
          secretHashSha256: promotedHash,
          previousSecretHashSha256: hashSecret("old-secret"),
          status: "active",
          rotationState: "old_revoked",
        }),
      ),
    );

    await expect(
      service.validateEnvironmentSecret("smoke-service", "new-secret", "test"),
    ).resolves.toBe(true);
    await expect(
      service.validateEnvironmentSecret("smoke-service", "old-secret", "test"),
    ).resolves.toBe(false);
  });

  it("rejects a raw hash payload after scoped secret migration", async () => {
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    process.env.GCP_PROJECT_ID = "api-center-test";
    const hash = hashSecret("plain-secret");
    accessSecretVersion.mockReturnValueOnce(secretResponse(hash));

    await expect(
      service.validateEnvironmentSecret("smoke-service", "plain-secret", "test"),
    ).resolves.toBe(false);
  });

  it("rejects malformed GCP payloads", async () => {
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    process.env.GCP_PROJECT_ID = "api-center-test";
    accessSecretVersion.mockReturnValueOnce(
      secretResponse(
        JSON.stringify({
          serviceId: "smoke-service",
          environment: "test",
          status: "active",
          secretHashSha256: "x",
        }),
      ),
    );

    await expect(
      service.validateEnvironmentSecret("smoke-service", "plain-secret", "test"),
    ).resolves.toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("secretHashSha256 is malformed"),
      "ServiceSecretResolverService",
    );
  });

  it("uses cache until the configured TTL expires", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-05-14T00:00:00.000Z"));
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    process.env.GCP_PROJECT_ID = "api-center-test";
    process.env.TRIBE_SECRET_CACHE_TTL_SECONDS = "1";
    const firstHash = hashSecret("first-secret");
    const secondHash = hashSecret("second-secret");
    accessSecretVersion
      .mockReturnValueOnce(
        secretResponse(
          JSON.stringify({
            serviceId: "smoke-service",
            environment: "test",
            secretHashSha256: firstHash,
            status: "active",
          }),
        ),
      )
      .mockReturnValueOnce(
        secretResponse(
          JSON.stringify({
            serviceId: "smoke-service",
            environment: "test",
            secretHashSha256: secondHash,
            status: "active",
          }),
        ),
      );

    await expect(
      service.resolveEnvironmentSecretHash("smoke-service", "test"),
    ).resolves.toBe(firstHash);
    await expect(
      service.resolveEnvironmentSecretHash("smoke-service", "test"),
    ).resolves.toBe(firstHash);

    jest.setSystemTime(new Date("2026-05-14T00:00:01.001Z"));

    await expect(
      service.resolveEnvironmentSecretHash("smoke-service", "test"),
    ).resolves.toBe(secondHash);
    expect(accessSecretVersion).toHaveBeenCalledTimes(2);
  });
});
