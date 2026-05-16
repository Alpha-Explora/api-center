import { Inject, Injectable, Optional } from "@nestjs/common";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import crypto from "node:crypto";
import { LoggerService } from "../shared/logger.service";

export type SecretManagerClientLike = Pick<
  SecretManagerServiceClient,
  "accessSecretVersion"
>;

type CachedSecret = {
  hash: string;
  expiresAt: number;
};

type TribeSecretPayload = {
  serviceId?: unknown;
  secretHashSha256?: unknown;
  status?: unknown;
};

const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const DEFAULT_SECRET_PREFIX = "api-center-tribe-secret-";
const DEFAULT_CACHE_TTL_SECONDS = 300;
export const TRIBE_SECRET_MANAGER_CLIENT = Symbol(
  "TRIBE_SECRET_MANAGER_CLIENT",
);

@Injectable()
export class TribeSecretResolverService {
  private readonly cache = new Map<string, CachedSecret>();
  private secretManagerClient: SecretManagerClientLike | null;

  constructor(
    private readonly logger: LoggerService,
    @Optional()
    @Inject(TRIBE_SECRET_MANAGER_CLIENT)
    secretManagerClient?: SecretManagerClientLike,
  ) {
    this.secretManagerClient = secretManagerClient ?? null;
  }

  async validateSecret(
    serviceId: string,
    plaintextSecret: string,
  ): Promise<boolean> {
    const expectedHash = await this.resolveSecretHash(serviceId);
    if (!expectedHash) return false;

    const requestHash = crypto
      .createHash("sha256")
      .update(plaintextSecret)
      .digest("hex");

    if (requestHash.length !== expectedHash.length) return false;

    return crypto.timingSafeEqual(
      Buffer.from(requestHash, "utf8"),
      Buffer.from(expectedHash, "utf8"),
    );
  }

  async resolveSecretHash(serviceId: string): Promise<string | null> {
    const normalizedServiceId = this.normalizeServiceId(serviceId);
    if (!normalizedServiceId) {
      this.logger.warn(
        `Tribe secret lookup rejected invalid serviceId '${serviceId}'`,
        "TribeSecretResolverService",
      );
      return null;
    }

    const legacyHash = this.getLegacyEnvHash(normalizedServiceId);
    if (legacyHash) return legacyHash;

    if (process.env.TRIBE_SECRET_SOURCE !== "gcp-secret-manager") {
      return null;
    }

    const cached = this.cache.get(normalizedServiceId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.hash;
    }

    const resolvedHash = await this.getGcpSecretHash(normalizedServiceId);
    if (!resolvedHash) return null;

    this.cache.set(normalizedServiceId, {
      hash: resolvedHash,
      expiresAt: Date.now() + this.getCacheTtlMs(),
    });

    return resolvedHash;
  }

  clearCache(serviceId?: string): void {
    if (!serviceId) {
      this.cache.clear();
      return;
    }

    const normalizedServiceId = this.normalizeServiceId(serviceId);
    if (normalizedServiceId) {
      this.cache.delete(normalizedServiceId);
    }
  }

  private getLegacyEnvHash(serviceId: string): string | null {
    const envKey = `TRIBE_SECRET_${serviceId.toUpperCase().replaceAll("-", "_")}`;
    const hash = process.env[envKey]?.trim();
    if (!hash) return null;

    if (!this.isValidHash(hash)) {
      this.logger.warn(
        `Tribe secret env '${envKey}' is malformed`,
        "TribeSecretResolverService",
      );
      return null;
    }

    return hash.toLowerCase();
  }

  private async getGcpSecretHash(serviceId: string): Promise<string | null> {
    const projectId =
      process.env.GCP_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT;

    if (!projectId) {
      this.logger.warn(
        "Tribe Secret Manager lookup skipped - set GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT",
        "TribeSecretResolverService",
      );
      return null;
    }

    const prefix = process.env.TRIBE_SECRET_GCP_PREFIX || DEFAULT_SECRET_PREFIX;
    const secretName = `${prefix}${serviceId}`;
    const resourceName = `projects/${projectId}/secrets/${secretName}/versions/latest`;

    try {
      const [response] =
        await this.getSecretManagerClient().accessSecretVersion({
          name: resourceName,
        });
      const rawPayload = response.payload?.data;
      if (!rawPayload) {
        this.logger.warn(
          `Tribe Secret Manager secret '${secretName}' returned an empty payload`,
          "TribeSecretResolverService",
        );
        return null;
      }

      const raw = Buffer.isBuffer(rawPayload)
        ? rawPayload.toString("utf8")
        : Buffer.from(rawPayload).toString("utf8");

      return this.parsePayload(serviceId, secretName, raw);
    } catch (error) {
      this.logger.warn(
        `Tribe Secret Manager lookup failed for '${secretName}': ${(error as Error).message}`,
        "TribeSecretResolverService",
      );
      return null;
    }
  }

  private parsePayload(
    serviceId: string,
    secretName: string,
    rawPayload: string,
  ): string | null {
    const normalizedPayload = rawPayload.trim();
    if (this.isValidHash(normalizedPayload)) {
      return normalizedPayload.toLowerCase();
    }

    let parsed: TribeSecretPayload;
    try {
      parsed = JSON.parse(normalizedPayload) as TribeSecretPayload;
    } catch {
      this.logger.warn(
        `Tribe Secret Manager secret '${secretName}' payload is not JSON or a raw SHA-256 hash`,
        "TribeSecretResolverService",
      );
      return null;
    }

    const payloadServiceId =
      typeof parsed.serviceId === "string"
        ? this.normalizeServiceId(parsed.serviceId)
        : null;
    if (payloadServiceId && payloadServiceId !== serviceId) {
      this.logger.warn(
        `Tribe Secret Manager secret '${secretName}' serviceId '${payloadServiceId}' does not match '${serviceId}'`,
        "TribeSecretResolverService",
      );
      return null;
    }

    if (parsed.status && parsed.status !== "active") {
      this.logger.warn(
        `Tribe Secret Manager secret '${secretName}' is inactive`,
        "TribeSecretResolverService",
      );
      return null;
    }

    if (
      typeof parsed.secretHashSha256 !== "string" ||
      !this.isValidHash(parsed.secretHashSha256)
    ) {
      this.logger.warn(
        `Tribe Secret Manager secret '${secretName}' secretHashSha256 is malformed`,
        "TribeSecretResolverService",
      );
      return null;
    }

    return parsed.secretHashSha256.toLowerCase();
  }

  private getSecretManagerClient(): SecretManagerClientLike {
    if (!this.secretManagerClient) {
      this.secretManagerClient = new SecretManagerServiceClient();
    }
    return this.secretManagerClient;
  }

  private getCacheTtlMs(): number {
    const ttlSeconds = Number.parseInt(
      process.env.TRIBE_SECRET_CACHE_TTL_SECONDS || "",
      10,
    );
    const safeTtlSeconds =
      Number.isFinite(ttlSeconds) && ttlSeconds > 0
        ? ttlSeconds
        : DEFAULT_CACHE_TTL_SECONDS;

    return safeTtlSeconds * 1000;
  }

  private isValidHash(hash: string): boolean {
    return SHA_256_HEX_PATTERN.test(hash.trim());
  }

  private normalizeServiceId(serviceId: string): string | null {
    const normalized = serviceId.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(normalized)) {
      return null;
    }
    return normalized;
  }
}
