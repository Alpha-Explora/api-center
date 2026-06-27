import { Inject, Injectable, Optional } from "@nestjs/common";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import crypto from "node:crypto";
import { LoggerService } from "../shared/logger.service";
import { TribeSecretRotationService } from "../secrets/tribe-secret-rotation.service";
import type { ApicenterRuntimeEnvironment } from "../types";
import { buildEnvironmentSecretId } from "./environment-secret-name";

export type SecretManagerClientLike = Pick<
  SecretManagerServiceClient,
  "accessSecretVersion"
>;

type CachedSecret = {
  hashes: string[];
  expiresAt: number;
};

type TribeSecretPayload = {
  serviceId?: unknown;
  tribeId?: unknown;
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
    @Optional()
    private readonly rotationService: TribeSecretRotationService = new TribeSecretRotationService(),
  ) {
    this.secretManagerClient = secretManagerClient ?? null;
  }

  async validateSecret(
    serviceId: string,
    plaintextSecret: string,
  ): Promise<boolean> {
    return this.validateLegacySecret(serviceId, plaintextSecret);
  }

  async validateLegacySecret(
    serviceId: string,
    plaintextSecret: string,
  ): Promise<boolean> {
    const expectedHashes = await this.resolveSecretHashes(serviceId);
    return this.matchesSecretHashes(plaintextSecret, expectedHashes);
  }

  async validateEnvironmentSecret(
    tribeId: string,
    plaintextSecret: string,
    environment: ApicenterRuntimeEnvironment,
  ): Promise<boolean> {
    const expectedHashes = await this.resolveEnvironmentSecretHashes(
      tribeId,
      environment,
    );
    return this.matchesSecretHashes(plaintextSecret, expectedHashes);
  }

  async resolveSecretHash(serviceId: string): Promise<string | null> {
    const hashes = await this.resolveSecretHashes(serviceId);
    return hashes[0] ?? null;
  }

  async resolveEnvironmentSecretHash(
    tribeId: string,
    environment: ApicenterRuntimeEnvironment,
  ): Promise<string | null> {
    const hashes = await this.resolveEnvironmentSecretHashes(
      tribeId,
      environment,
    );
    return hashes[0] ?? null;
  }

  private async resolveSecretHashes(serviceId: string): Promise<string[]> {
    const normalizedServiceId = this.normalizeServiceId(serviceId);
    if (!normalizedServiceId) {
      this.logger.warn(
        `Tribe secret lookup rejected invalid serviceId '${serviceId}'`,
        "TribeSecretResolverService",
      );
      return [];
    }

    const legacyHash = this.getLegacyEnvHash(normalizedServiceId);
    if (legacyHash) return [legacyHash];

    if (process.env.TRIBE_SECRET_SOURCE !== "gcp-secret-manager") {
      return [];
    }

    const cacheKey = `legacy:${normalizedServiceId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.hashes;
    }

    const resolvedHashes = await this.getGcpSecretHashes(normalizedServiceId);
    if (resolvedHashes.length === 0) return [];

    this.cache.set(cacheKey, {
      hashes: resolvedHashes,
      expiresAt: Date.now() + this.getCacheTtlMs(),
    });

    return resolvedHashes;
  }

  private async resolveEnvironmentSecretHashes(
    tribeId: string,
    environment: ApicenterRuntimeEnvironment,
  ): Promise<string[]> {
    const normalizedTribeId = this.normalizeServiceId(tribeId);
    if (!normalizedTribeId) {
      this.logger.warn(
        `Tribe secret lookup rejected invalid tribeId '${tribeId}'`,
        "TribeSecretResolverService",
      );
      return [];
    }

    if (process.env.TRIBE_SECRET_SOURCE !== "gcp-secret-manager") {
      return [];
    }

    const cacheKey = `environment:${normalizedTribeId}:${environment}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.hashes;
    }

    const resolvedHashes = await this.getGcpEnvironmentSecretHashes(
      normalizedTribeId,
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
      if (
        key === normalizedServiceId ||
        key === `legacy:${normalizedServiceId}` ||
        key.startsWith(`environment:${normalizedServiceId}:`)
      ) {
        this.cache.delete(key);
      }
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

  private async getGcpSecretHashes(serviceId: string): Promise<string[]> {
    const projectId = this.getProjectId();
    if (!projectId) return [];

    const prefix = process.env.TRIBE_SECRET_GCP_PREFIX || DEFAULT_SECRET_PREFIX;
    const secretName = `${prefix}${serviceId}`;
    const resourceName = `projects/${projectId}/secrets/${secretName}/versions/latest`;

    try {
      const raw = await this.readSecretPayload(resourceName, secretName);
      if (!raw) return [];
      return this.parsePayload(serviceId, secretName, raw);
    } catch (error) {
      this.logger.warn(
        `Tribe Secret Manager lookup failed for '${secretName}': ${(error as Error).message}`,
        "TribeSecretResolverService",
      );
      return [];
    }
  }

  private async getGcpEnvironmentSecretHashes(
    tribeId: string,
    environment: ApicenterRuntimeEnvironment,
  ): Promise<string[]> {
    const projectId = this.getProjectId();
    if (!projectId) return [];

    const secretName = buildEnvironmentSecretId(tribeId, environment);
    const resourceName = `projects/${projectId}/secrets/${secretName}/versions/latest`;

    try {
      const raw = await this.readSecretPayload(resourceName, secretName);
      if (!raw) return [];
      return this.parseEnvironmentPayload(tribeId, environment, secretName, raw);
    } catch (error) {
      this.logger.warn(
        `Tribe Secret Manager lookup failed for '${secretName}': ${(error as Error).message}`,
        "TribeSecretResolverService",
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
        "Tribe Secret Manager lookup skipped - set GCP_PROJECT_ID or GOOGLE_CLOUD_PROJECT",
        "TribeSecretResolverService",
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
        `Tribe Secret Manager secret '${secretName}' returned an empty payload`,
        "TribeSecretResolverService",
      );
      return null;
    }

    return Buffer.isBuffer(rawPayload)
      ? rawPayload.toString("utf8")
      : Buffer.from(rawPayload).toString("utf8");
  }

  private parsePayload(
    serviceId: string,
    secretName: string,
    rawPayload: string,
  ): string[] {
    const normalizedPayload = rawPayload.trim();
    if (this.isValidHash(normalizedPayload)) {
      return [normalizedPayload.toLowerCase()];
    }

    const parsed = this.parseJsonPayload(secretName, normalizedPayload);
    if (!parsed) return [];

    const payloadServiceId =
      typeof parsed.serviceId === "string"
        ? this.normalizeServiceId(parsed.serviceId)
        : null;
    if (payloadServiceId && payloadServiceId !== serviceId) {
      this.logger.warn(
        `Tribe Secret Manager secret '${secretName}' serviceId '${payloadServiceId}' does not match '${serviceId}'`,
        "TribeSecretResolverService",
      );
      return [];
    }

    return this.extractAcceptedHashes(parsed, secretName);
  }

  private parseEnvironmentPayload(
    tribeId: string,
    environment: ApicenterRuntimeEnvironment,
    secretName: string,
    rawPayload: string,
  ): string[] {
    const normalizedPayload = rawPayload.trim();
    const parsed = this.parseJsonPayload(secretName, normalizedPayload);
    if (!parsed) return [];

    const payloadTribeId =
      typeof parsed.tribeId === "string"
        ? this.normalizeServiceId(parsed.tribeId)
        : null;
    if (!payloadTribeId) {
      this.logger.warn(
        `Tribe Secret Manager secret '${secretName}' tribeId is missing or malformed`,
        "TribeSecretResolverService",
      );
      return [];
    }
    if (payloadTribeId !== tribeId) {
      this.logger.warn(
        `Tribe Secret Manager secret '${secretName}' tribeId '${payloadTribeId}' does not match '${tribeId}'`,
        "TribeSecretResolverService",
      );
      return [];
    }

    if (parsed.environment !== environment) {
      this.logger.warn(
        `Tribe Secret Manager secret '${secretName}' environment '${String(parsed.environment)}' does not match '${environment}'`,
        "TribeSecretResolverService",
      );
      return [];
    }

    return this.extractAcceptedHashes(parsed, secretName);
  }

  private parseJsonPayload(
    secretName: string,
    normalizedPayload: string,
  ): TribeSecretPayload | null {
    try {
      return JSON.parse(normalizedPayload) as TribeSecretPayload;
    } catch {
      this.logger.warn(
        `Tribe Secret Manager secret '${secretName}' payload is not JSON or a raw SHA-256 hash`,
        "TribeSecretResolverService",
      );
      return null;
    }
  }

  private extractAcceptedHashes(
    parsed: TribeSecretPayload,
    secretName: string,
  ): string[] {
    if (parsed.status && parsed.status !== "active") {
      this.logger.warn(
        `Tribe Secret Manager secret '${secretName}' is inactive`,
        "TribeSecretResolverService",
      );
      return [];
    }

    const acceptedHashes = this.rotationService.getAcceptedSecretHashes(parsed);
    if (acceptedHashes.length === 0) {
      this.logger.warn(
        `Tribe Secret Manager secret '${secretName}' secretHashSha256 is malformed`,
        "TribeSecretResolverService",
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