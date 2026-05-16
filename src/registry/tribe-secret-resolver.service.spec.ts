import crypto from "node:crypto";
import { LoggerService } from "../shared/logger.service";
import {
  SecretManagerClientLike,
  TribeSecretResolverService,
} from "./tribe-secret-resolver.service";

const mockLogger: Partial<LoggerService> = {
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
};

const hashSecret = (secret: string) =>
  crypto.createHash("sha256").update(secret).digest("hex");

const secretResponse = (payload: string) =>
  Promise.resolve([
    {
      payload: {
        data: Buffer.from(payload, "utf8"),
      },
    },
  ]);

describe("TribeSecretResolverService", () => {
  const originalEnv = process.env;
  let accessSecretVersion: jest.Mock;
  let service: TribeSecretResolverService;

  beforeEach(() => {
    jest.useRealTimers();
    process.env = { ...originalEnv };
    delete process.env.TRIBE_SECRET_SMOKE_TRIBE;
    delete process.env.TRIBE_SECRET_SOURCE;
    delete process.env.TRIBE_SECRET_GCP_PREFIX;
    delete process.env.TRIBE_SECRET_CACHE_TTL_SECONDS;
    delete process.env.GCP_PROJECT_ID;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;

    jest.clearAllMocks();
    accessSecretVersion = jest.fn();
    service = new TribeSecretResolverService(
      mockLogger as LoggerService,
      {
        accessSecretVersion,
      } as SecretManagerClientLike,
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("validates a legacy env-backed tribe secret", async () => {
    process.env.TRIBE_SECRET_SMOKE_TRIBE = hashSecret("plain-secret");

    await expect(
      service.validateSecret("smoke-tribe", "plain-secret"),
    ).resolves.toBe(true);
    await expect(
      service.validateSecret("smoke-tribe", "wrong-secret"),
    ).resolves.toBe(false);
    expect(accessSecretVersion).not.toHaveBeenCalled();
  });

  it("validates a GCP Secret Manager JSON payload", async () => {
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    process.env.GCP_PROJECT_ID = "api-center-test";
    const hash = hashSecret("plain-secret");
    accessSecretVersion.mockReturnValueOnce(
      secretResponse(
        JSON.stringify({
          serviceId: "smoke-tribe",
          secretHashSha256: hash,
          status: "active",
        }),
      ),
    );

    await expect(
      service.validateSecret("smoke-tribe", "plain-secret"),
    ).resolves.toBe(true);
    expect(accessSecretVersion).toHaveBeenCalledWith({
      name: "projects/api-center-test/secrets/api-center-tribe-secret-smoke-tribe/versions/latest",
    });
  });

  it("supports a raw hash payload during migration", async () => {
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    process.env.GCP_PROJECT_ID = "api-center-test";
    const hash = hashSecret("plain-secret");
    accessSecretVersion.mockReturnValueOnce(secretResponse(hash));

    await expect(
      service.validateSecret("smoke-tribe", "plain-secret"),
    ).resolves.toBe(true);
  });

  it("rejects malformed GCP payloads", async () => {
    process.env.TRIBE_SECRET_SOURCE = "gcp-secret-manager";
    process.env.GCP_PROJECT_ID = "api-center-test";
    accessSecretVersion.mockReturnValueOnce(
      secretResponse(
        JSON.stringify({ status: "active", secretHashSha256: "x" }),
      ),
    );

    await expect(
      service.validateSecret("smoke-tribe", "plain-secret"),
    ).resolves.toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("secretHashSha256 is malformed"),
      "TribeSecretResolverService",
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
      .mockReturnValueOnce(secretResponse(firstHash))
      .mockReturnValueOnce(secretResponse(secondHash));

    await expect(service.resolveSecretHash("smoke-tribe")).resolves.toBe(
      firstHash,
    );
    await expect(service.resolveSecretHash("smoke-tribe")).resolves.toBe(
      firstHash,
    );

    jest.setSystemTime(new Date("2026-05-14T00:00:01.001Z"));

    await expect(service.resolveSecretHash("smoke-tribe")).resolves.toBe(
      secondHash,
    );
    expect(accessSecretVersion).toHaveBeenCalledTimes(2);
  });
});
