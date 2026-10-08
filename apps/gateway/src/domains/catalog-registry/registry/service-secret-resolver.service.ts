// =============================================================================
// Service credential resolver.
// =============================================================================
// Each tribe service has its own secret per environment, stored in Secret Manager as
// `<prefix><serviceId>-<environment>` (default prefix api-center-service-secret-). The JSON payload must
// name the same serviceId and environment and holds SHA-256 hashes only (current, next, previous during
// rotation). A token is therefore bound to one service; it cannot be minted for a sibling service.
// =============================================================================

import { Inject, Injectable, Optional } from "@nestjs/common";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import crypto from "node:crypto";
import { LoggerService } from "@shared/logger.service";
import { TribeSecretRotationService } from "@secrets/tribe-secret-rotation.service";
import type { ApicenterRuntimeEnvironment } from "../../../types";
import { buildEnvironmentSecretId } from "./environment-secret-name";

export type SecretManagerClientLike = Pick<
  SecretManagerServiceClient,
  "accessSecretVersion"
>;

type CachedSecret = {
  hashes: string[];
  expiresAt: number;
};

type ServiceSecretPayload = {
  serviceId?: unknown;
  environment?: unknown;
  secretHashSha256?: unknown;
  nextSecretHashSha256?: unknown;
  previousSecretHashSha256?: unknown;
  status?: unknown;
  rotationState?: unknown;
  rotatedAt?: unknown;
  verifiedAt?: unknown;
  revokedAt?: unknown;
  auditEvidence?: unknown;
};

const SHA_256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
const DEFAULT_CACHE_TTL_SECONDS = 300;
export const SERVICE_SECRET_MANAGER_CLIENT = Symbol(
  "SERVICE_SECRET_MANAGER_CLIENT",
);

@Injectable()
export class ServiceSecretResolverService {
  private readonly cache = new Map<string, CachedSecret>();
  private secretManagerClient: SecretManagerClientLike | null;

  constructor(
    private readonly logger: LoggerService,
    @Optional()
    @Inject(SERVICE_SECRET_MANAGER_CLIENT)
    secretManagerClient?: SecretManagerClientLike,
    @Optional()
    private readonly rotationService: TribeSecretRotationService = new TribeSecretRotationService(),
  ) {
    this.secretManagerClient = secretManagerClient ?? null;
  }

  async validateEnvironmentSecret(
    serviceId: string,
    plaintextSecret: string,
    environment: ApicenterRuntimeEnvironment,
  ): Promise<boolean> {
    const expectedHashes = await this.resolveEnvironmentSecretHashes(
      serviceId,
      environment,
    );
    return this.matchesSecretHashes(plaintextSecret, expectedHashes);
  }

  async resolveEnvironmentSecretHash(
    serviceId: string,
    environment: ApicenterRuntimeEnvironment,
  ): Promise<string | null> {
    const hashes = await this.resolveEnvironmentSecretHashes(
      serviceId,
      environment,
    );
    return hashes[0] ?? null;
  }

  private async resolveEnvironmentSecretHashes(
    serviceId: string,
    environment: ApicenterRuntimeEnvironment,
  ): Promise<string[]> {
    const normalizedServiceId = this.normalizeServiceId(serviceId);
    if (!normalizedServiceId) {
      this.logger.warn(
        `Service secret lookup rejected invalid serviceId '${serviceId}'`,
        "ServiceSecretResolverService",
      );
      return [];
    }

    if (process.env.TRIBE_SECRET_SOURCE !== "gcp-secret-manager") {
      return [];
    }

    const cacheKey = `environment:${normalizedServiceId}:${environment}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.hashes;
    }

    const resolvedHashes = await this.getGcpEnvironmentSecretHashes(
      normalizedServiceId,
      environment,
    );
    if (resolvedHashes.length === 0) return [];

    this.cache.set(cacheKey, {
      hashes: resolvedHashes,
      expiresAt: Date.now() + this.getCacheTtlMs(),
    });

    return resolvedHashes;
  }

  clearCache(serviceId?: string): void {
    if (!serviceId) {
      this.cache.clear();
      return;
    }

    const normalizedServiceId = this.normalizeServiceId(serviceId);
    if (!normalizedServiceId) return;

    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`environment:${normalizedServiceId}:`)) {
        this.cache.delete(key);
      }
    }
  }

  private async getGcpEnvironmentSecretHashes(
    serviceId: string,
    environment: ApicenterRuntimeEnvironment,
  ): Promise<string[]> {
    const projectId = this.getProjectId();
    if (!projectId) return [];

    const secretName = buildEnvironmentSecretId(serviceId, environment);
    const resourceName = `projects/${projectId}/secrets/${secretName}/versions/latest`;

    try {
      const raw = await this.readSecretPayload(resourceName, secretName);
      if (!raw) return [];
      return this.parseEnvironmentPayload(serviceId, environment, secretName, raw);
    } catch (error) {
      this.logger.warn(
        `Service Secret Manager lookup failed for '${secretName}': ${(error as Error).message}`,
        "ServiceSecretResolverService",
      );
      return [];
    }
  }

  private getProjectId(): string | null {
    const projectId =
      process.env.GCP_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT;

    if (!projectId) {
      this.logger.warn(
        "Service Secret Manager lookup skipped - set GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT",
        "ServiceSecretResolverService",
      );
      return null;
    }

    return projectId;
  }

  private async readSecretPayload(
    resourceName: string,
    secretName: string,
  ): Promise<string | null> {
    const [response] = await this.getSecretManagerClient().accessSecretVersion({
      name: resourceName,
    });
    const rawPayload = response.payload?.data;
    if (!rawPayload) {
      this.logger.warn(
        `Service Secret Manager secret '${secretName}' returned an empty payload`,
        "ServiceSecretResolverService",
      );
      return null;
    }

    return Buffer.isBuffer(rawPayload)
      ? rawPayload.toString("utf8")
      : Buffer.from(rawPayload).toString("utf8");
  }

  private parseEnvironmentPayload(
    serviceId: string,
    environment: ApicenterRuntimeEnvironment,
    secretName: string,
    rawPayload: string,
  ): string[] {
    const normalizedPayload = rawPayload.trim();
    const parsed = this.parseJsonPayload(secretName, normalizedPayload);
    if (!parsed) return [];

    const payloadServiceId =
      typeof parsed.serviceId === "string"
        ? this.normalizeServiceId(parsed.serviceId)
        : null;
    if (!payloadServiceId) {
      this.logger.warn(
        `Service Secret Manager secret '${secretName}' serviceId is missing or malformed`,
        "ServiceSecretResolverService",
      );
      return [];
    }
    if (payloadServiceId !== serviceId) {
      this.logger.warn(
        `Service Secret Manager secret '${secretName}' serviceId '${payloadServiceId}' does not match '${serviceId}'`,
        "ServiceSecretResolverService",
      );
      return [];
    }

    if (parsed.environment !== environment) {
      this.logger.warn(
        `Service Secret Manager secret '${secretName}' environment '${String(parsed.environment)}' does not match '${environment}'`,
        "ServiceSecretResolverService",
      );
      return [];
    }

    return this.extractAcceptedHashes(parsed, secretName);
  }

  private parseJsonPayload(
    secretName: string,
    normalizedPayload: string,
  ): ServiceSecretPayload | null {
    try {
      return JSON.parse(normalizedPayload) as ServiceSecretPayload;
    } catch {
      this.logger.warn(
        `Service Secret Manager secret '${secretName}' payload is not JSON or a raw SHA-256 hash`,
        "ServiceSecretResolverService",
      );
      return null;
    }
  }

  private extractAcceptedHashes(
    parsed: ServiceSecretPayload,
    secretName: string,
  ): string[] {
    if (parsed.status && parsed.status !== "active") {
      this.logger.warn(
        `Service Secret Manager secret '${secretName}' is inactive`,
        "ServiceSecretResolverService",
      );
      return [];
    }

    const acceptedHashes = this.rotationService.getAcceptedSecretHashes(parsed);
    if (acceptedHashes.length === 0) {
      this.logger.warn(
        `Service Secret Manager secret '${secretName}' secretHashSha256 is malformed`,
        "ServiceSecretResolverService",
      );
      return [];
    }

    return acceptedHashes;
  }

  private matchesSecretHashes(
    plaintextSecret: string,
    expectedHashes: string[],
  ): boolean {
    if (expectedHashes.length === 0) return false;

    const requestHash = crypto
      .createHash("sha256")
      .update(plaintextSecret)
      .digest("hex");

    return expectedHashes.some((expectedHash) => {
      if (requestHash.length !== expectedHash.length) return false;

      return crypto.timingSafeEqual(
        Buffer.from(requestHash, "utf8"),
        Buffer.from(expectedHash, "utf8"),
      );
    });
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
    if (!/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(normalized)) {
      return null;
    }
    return normalized;
  }
}
