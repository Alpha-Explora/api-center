import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { ConfigService } from "../config/config.service";
import { MetricsService } from "../metrics/metrics.service";
import { LoggerService } from "../shared/logger.service";
import { ServiceManifest, ServiceTier, ServiceType } from "../types";
import { RegistryService } from "./registry.service";

const VALID_SERVICE_TYPES = new Set<ServiceType>(["shared", "tribe"]);
const VALID_SERVICE_TIERS = new Set<ServiceTier>([
  "critical",
  "standard",
  "experimental",
]);

@Injectable()
export class RegistryBootstrapService implements OnApplicationBootstrap {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
    private readonly metrics: MetricsService,
    private readonly registry: RegistryService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.registryBootstrap.enabled) {
      return;
    }

    const manifestPaths = this.config.registryBootstrap.manifestPaths;
    const seededServiceIds = new Set<string>();
    let loadedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const configuredPath of manifestPaths) {
      const manifestPath = this.resolveManifestPath(configuredPath);
      const seedSource = configuredPath;

      try {
        const manifest = await this.readManifest(manifestPath);

        if (seededServiceIds.has(manifest.serviceId)) {
          skippedCount += 1;
          this.metrics.recordRegistryBootstrapSeed(
            "skipped",
            seedSource,
            manifest.serviceType ?? "tribe",
            "active",
          );
          this.logger.warn(
            `Registry bootstrap skipped duplicate serviceId '${manifest.serviceId}' from '${manifestPath}'`,
            "RegistryBootstrapService",
          );
          continue;
        }

        const entry = await this.registry.register(manifest);
        seededServiceIds.add(manifest.serviceId);

        loadedCount += 1;
        this.metrics.recordRegistryBootstrapSeed(
          "loaded",
          seedSource,
          entry.serviceType ?? "tribe",
          entry.status,
        );
        this.logger.info("Registry bootstrap manifest loaded", {
          serviceId: manifest.serviceId,
          serviceType: entry.serviceType ?? "tribe",
          lifecycleStatus: entry.status,
          seedSource,
          manifestPath,
        });
      } catch (error) {
        failedCount += 1;
        this.metrics.recordRegistryBootstrapSeed(
          "failed",
          seedSource,
          "tribe",
          "proposed",
        );
        this.logger.warn(
          `Registry bootstrap failed for '${manifestPath}': ${(error as Error).message}`,
          "RegistryBootstrapService",
        );
      }
    }

    this.logger.info("Registry bootstrap completed", {
      configured: manifestPaths.length,
      loaded: loadedCount,
      skipped: skippedCount,
      failed: failedCount,
    });
  }

  private async readManifest(manifestPath: string): Promise<ServiceManifest> {
    const fileContents = await readFile(manifestPath, "utf-8");
    const parsed = JSON.parse(fileContents) as Partial<ServiceManifest>;

    return this.normalizeManifest(parsed, manifestPath);
  }

  private normalizeManifest(
    parsed: Partial<ServiceManifest>,
    manifestPath: string,
  ): ServiceManifest {
    const serviceId = this.ensureNonEmptyString(
      parsed.serviceId,
      "serviceId",
      manifestPath,
    );
    const name = this.ensureNonEmptyString(parsed.name, "name", manifestPath);
    const baseUrl = this.toHttpUrlString(
      parsed.baseUrl,
      "baseUrl",
      manifestPath,
    );
    const requiredScopes = this.toStringArray(
      parsed.requiredScopes,
      "requiredScopes",
      manifestPath,
      {
        allowEmpty: false,
        unique: true,
      },
    );
    const exposes = this.toStringArray(
      parsed.exposes,
      "exposes",
      manifestPath,
      {
        allowEmpty: false,
        unique: true,
      },
    );
    const consumes = this.toOptionalStringArray(
      parsed.consumes,
      "consumes",
      manifestPath,
    );
    const serviceType = this.toServiceType(parsed.serviceType, manifestPath);

    const manifest: ServiceManifest = {
      serviceId,
      name,
      baseUrl,
      requiredScopes,
      exposes,
      consumes,
      serviceType,
    };

    this.applyOptionalHealthCheck(parsed.healthCheck, manifestPath, manifest);
    this.applyOptionalStringField(parsed.version, "version", manifest);
    this.applyOptionalStringField(parsed.description, "description", manifest);
    this.applyOptionalTags(parsed.tags, manifestPath, manifest);
    this.applyOptionalStringField(parsed.ownerTeam, "ownerTeam", manifest);
    this.applyOptionalStringField(parsed.contact, "contact", manifest);
    this.applyOptionalServiceTier(parsed.serviceTier, manifestPath, manifest);
    this.applyOptionalStringField(parsed.costCenter, "costCenter", manifest);
    this.applyOptionalStringField(parsed.sunsetDate, "sunsetDate", manifest);
    this.applyOptionalStringField(
      parsed.replacementService,
      "replacementService",
      manifest,
    );

    return manifest;
  }

  private applyOptionalHealthCheck(
    healthCheck: unknown,
    manifestPath: string,
    manifest: ServiceManifest,
  ): void {
    if (typeof healthCheck !== "string" || healthCheck.trim().length === 0) {
      return;
    }

    if (!healthCheck.startsWith("/")) {
      throw new Error(
        `Invalid healthCheck in '${manifestPath}': expected a path starting with '/'`,
      );
    }

    manifest.healthCheck = healthCheck.trim();
  }

  private applyOptionalStringField(
    rawValue: unknown,
    key:
      | "version"
      | "description"
      | "ownerTeam"
      | "contact"
      | "costCenter"
      | "sunsetDate"
      | "replacementService",
    manifest: ServiceManifest,
  ): void {
    if (typeof rawValue !== "string" || rawValue.trim().length === 0) {
      return;
    }

    manifest[key] = rawValue.trim();
  }

  private applyOptionalTags(
    tags: unknown,
    manifestPath: string,
    manifest: ServiceManifest,
  ): void {
    if (!Array.isArray(tags)) {
      return;
    }

    manifest.tags = this.toStringArray(tags, "tags", manifestPath, {
      allowEmpty: true,
      unique: true,
    });
  }

  private applyOptionalServiceTier(
    serviceTier: unknown,
    manifestPath: string,
    manifest: ServiceManifest,
  ): void {
    const normalizedTier = this.toServiceTier(serviceTier, manifestPath);
    if (normalizedTier) {
      manifest.serviceTier = normalizedTier;
    }
  }

  private resolveManifestPath(configuredPath: string): string {
    if (path.isAbsolute(configuredPath)) {
      return configuredPath;
    }

    return path.resolve(process.cwd(), configuredPath);
  }

  private ensureNonEmptyString(
    value: unknown,
    fieldName: string,
    manifestPath: string,
  ): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Invalid ${fieldName} in '${manifestPath}'`);
    }

    return value.trim();
  }

  private toHttpUrlString(
    value: unknown,
    fieldName: string,
    manifestPath: string,
  ): string {
    const stringValue = this.ensureNonEmptyString(
      value,
      fieldName,
      manifestPath,
    );

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(stringValue);
    } catch {
      throw new Error(
        `Invalid ${fieldName} in '${manifestPath}': expected an absolute URL`,
      );
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error(
        `Invalid ${fieldName} in '${manifestPath}': only http/https are supported`,
      );
    }

    return parsedUrl.toString().replace(/\/$/, "");
  }

  private toStringArray(
    value: unknown,
    fieldName: string,
    manifestPath: string,
    options: { allowEmpty: boolean; unique: boolean },
  ): string[] {
    if (!Array.isArray(value)) {
      throw new TypeError(`Invalid ${fieldName} in '${manifestPath}'`);
    }

    const normalized = value.map((item) => {
      if (typeof item !== "string" || item.trim().length === 0) {
        throw new Error(
          `Invalid ${fieldName} in '${manifestPath}': each entry must be a non-empty string`,
        );
      }
      return item.trim();
    });

    if (!options.allowEmpty && normalized.length === 0) {
      throw new Error(
        `Invalid ${fieldName} in '${manifestPath}': at least one value is required`,
      );
    }

    if (options.unique) {
      const uniqueCount = new Set(normalized).size;
      if (uniqueCount !== normalized.length) {
        throw new Error(
          `Invalid ${fieldName} in '${manifestPath}': duplicate values are not allowed`,
        );
      }
    }

    return normalized;
  }

  private toOptionalStringArray(
    value: unknown,
    fieldName: string,
    manifestPath: string,
  ): string[] {
    if (value === undefined) {
      return [];
    }

    return this.toStringArray(value, fieldName, manifestPath, {
      allowEmpty: true,
      unique: true,
    });
  }

  private toServiceType(value: unknown, manifestPath: string): ServiceType {
    if (value === undefined) {
      return "tribe";
    }

    if (
      typeof value !== "string" ||
      !VALID_SERVICE_TYPES.has(value as ServiceType)
    ) {
      throw new Error(`Invalid serviceType in '${manifestPath}'`);
    }

    return value as ServiceType;
  }

  private toServiceTier(
    value: unknown,
    manifestPath: string,
  ): ServiceTier | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (
      typeof value !== "string" ||
      !VALID_SERVICE_TIERS.has(value as ServiceTier)
    ) {
      throw new Error(`Invalid serviceTier in '${manifestPath}'`);
    }

    return value as ServiceTier;
  }
}
