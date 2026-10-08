// =============================================================================
// src/registry/registry.service.ts — Dynamic Service Registry (NestJS)
// =============================================================================
// The heart of the "Dynamic Service Registry" platform. Services register
// themselves at runtime by POSTing a ServiceManifest.
//
// STORAGE STRATEGY (layered):
//  1. In-memory Map  - hot cache for zero-latency lookups.
//  2. Redis          - default persistent source shared across instances.
//  3. Postgres       - optional source when REGISTRY_SOURCE=postgres, with
//                      DATABASE_DUAL_WRITE=true used during cutover.
//
// On startup (OnModuleInit), entries are loaded from Redis by default or from
// Postgres after explicit cutover. Registration/deregistration always updates
// memory and Redis, and also writes Postgres when dual-write is enabled.
// =============================================================================

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
import Redis from "ioredis";
import {
  ApicenterRuntimeEnvironment,
  ServiceEnvironmentKey,
  ServiceEnvironmentManifest,
  ServiceManifest,
  ServiceRegistryEntry,
  ServiceRegistryMap,
  ServiceType,
} from "../../../types";
import { LoggerService } from "@shared/logger.service";
import { ConfigService } from "@config/config.service";
import { MetricsService } from "@metrics/metrics.service";
import {
  NotFoundError,
  ConflictError,
  ValidationError,
} from "@shared/errors";
import { ServiceSecretResolverService } from "./service-secret-resolver.service";
import { PostgresRegistryStoreService } from "./postgres-registry-store.service";
import { TenancyService } from "./tenancy.service";
import type { ProjectPlacement } from "./tenancy.types";
import { normalizeServiceEnvironments } from "./environment-resolver";
import {
  createRegistryEntry,
  normalizeRegistryEntry,
} from "./manifest-normalizer";

const REDIS_REGISTRY_KEY = "api-center:registry:services";

/** Default timeout for critical Redis writes (ms). */
const REDIS_WRITE_TIMEOUT_MS = 2_000;

@Injectable()
export class RegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly services: ServiceRegistryMap = {};
  private readonly servicesByOwnerTribeId = new Map<string, Set<string>>();
  private readonly servicesByProjectId = new Map<string, Set<string>>();
  private readonly consumersByTargetServiceId = new Map<string, Set<string>>();
  private redis: Redis | null = null;
  private readonly cacheInvalidationListeners = new Set<
    (serviceId: string) => void
  >();

  constructor(
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
    private readonly metrics: MetricsService,
    private readonly serviceSecretResolver: ServiceSecretResolverService,
    private readonly tenancy: TenancyService,
    @Optional()
    private readonly postgresStore?: PostgresRegistryStoreService,
  ) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async onModuleInit() {
    const registrySource = this.config.database.registrySource;

    try {
      this.redis = this.createRedisClient();
      await this.redis.connect();
      this.logger.info("Registry connected to Redis (cache)", {});

    } catch (err) {
      this.logger.warn(
        `Registry Redis unavailable — running in memory-only mode: ${(err as Error).message}`,
        "RegistryService",
      );
      this.redis = null;
    }

    if (registrySource === "postgres") {
      await this.loadFromPostgres();
      return;
    }

    try {
      await this.loadFromRedis();
    } catch (err) {
      this.logger.warn(
        `Registry Redis load failed â€” running in memory-only mode: ${(err as Error).message}`,
        "RegistryService",
      );
    }
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
      this.logger.info("Registry Redis connection closed", {});
    }
  }

  private createRedisClient(): Redis {
    return new Redis(this.config.redis.cacheUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 3000),
    });
  }

  // -------------------------------------------------------------------------
  // Cache invalidation listeners
  // -------------------------------------------------------------------------

  /**
   * Register a listener that is notified whenever a service is re-registered
   * (e.g. its baseUrl may have changed). Returns an unsubscribe function.
   * Used by ProxyHandler to drop stale cached middleware instances.
   */
  onCacheInvalidation(listener: (serviceId: string) => void): () => void {
    this.cacheInvalidationListeners.add(listener);
    return () => {
      this.cacheInvalidationListeners.delete(listener);
    };
  }

  private notifyCacheInvalidation(serviceId: string): void {
    for (const listener of this.cacheInvalidationListeners) {
      try {
        listener(serviceId);
      } catch (err) {
        this.logger.warn(
          `Cache invalidation listener error for '${serviceId}': ${(err as Error).message}`,
          "RegistryService",
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  /**
   * Register a new service or update an existing one.
   * Writes to the in-memory cache plus the configured persistent stores.
   * Validates semver on updates and tracks version changes.
   *
   * Redis persistence is awaited with a strict timeout. Postgres persistence is
   * also awaited when DATABASE_DUAL_WRITE=true so cutover drift is visible.
   */
  async register(manifest: ServiceManifest): Promise<ServiceRegistryEntry> {
    const now = new Date().toISOString();
    const existing = this.services[manifest.serviceId];
    const previousEntry = existing ? { ...existing } : null;

    if ((manifest.serviceType ?? "tribe") !== "shared") {
      await this.tenancy.refreshIfMissing(manifest.projectId);
    }
    const placement = this.resolvePlacement(manifest, existing);

    // ── Version governance ─────────────────────────────────────────────────
    let previousVersion: string | undefined;
    if (existing && manifest.version && existing.version) {
      previousVersion = existing.version;
      this.validateVersionUpgrade(existing.version, manifest.version);
    }

    // ── Block registration if service is retired ───────────────────────────
    if (existing?.status === "retired") {
      throw new ConflictError(
        `Service '${manifest.serviceId}' is retired and cannot be re-registered`,
      );
    }

    const entry = createRegistryEntry(manifest, {
      existing,
      now,
      previousVersion,
      ownerTribeId: placement?.tribe.tribeId,
    });

    this.services[manifest.serviceId] = entry;
    this.reindexService(entry, existing);
    this.syncMetricsGauge();

    // Persist to Redis with a strict timeout. If Postgres dual-write is enabled,
    // failures roll Redis back so the cutover stores do not silently drift.
    try {
      await this.persistRegistryEntryStrict(manifest.serviceId, entry, {
        previousEntry,
      });
    } catch (err) {
      if (previousEntry) {
        this.services[manifest.serviceId] = previousEntry;
        this.reindexService(previousEntry, entry);
      } else {
        delete this.services[manifest.serviceId];
        this.removeServiceFromIndexes(entry);
      }
      this.syncMetricsGauge();
      throw err;
    }

    this.logger.info("Service registered", {
      serviceId: manifest.serviceId,
      projectId: entry.projectId,
      ownerTribeId: entry.ownerTribeId,
      name: manifest.name,
      baseUrl: manifest.baseUrl,
      exposes: manifest.exposes,
      isUpdate: !!existing,
      version: manifest.version,
    });

    // ── Invalidate proxy caches on re-registration (baseUrl may have changed)
    if (existing) {
      this.notifyCacheInvalidation(manifest.serviceId);
    }

    return entry;
  }

  /**
   * Tribe services must name an active project; their tribe is derived from it.
   * A registered service never changes project: moving it means registering a new service.
   * Shared platform services have no project.
   */
  private resolvePlacement(
    manifest: ServiceManifest,
    existing: ServiceRegistryEntry | undefined,
  ): ProjectPlacement | null {
    if ((manifest.serviceType ?? "tribe") === "shared") {
      const hasSuppliedOwner = Object.prototype.hasOwnProperty.call(
        manifest,
        "ownerTribeId",
      );
      if (manifest.projectId || hasSuppliedOwner) {
        throw new ValidationError(
          `Shared service '${manifest.serviceId}' cannot have tribe or project placement`,
        );
      }
      return null;
    }

    const placement = this.tenancy.requireActiveProject(manifest.projectId);
    if (existing?.projectId && existing.projectId !== placement.project.projectId) {
      throw new ConflictError(
        `Service '${manifest.serviceId}' belongs to project '${existing.projectId}' and cannot move to '${placement.project.projectId}'`,
      );
    }
    return placement;
  }

  /**
   * Remove a service from the registry.
   * Removes from memory, Redis, and Postgres when dual-write is enabled.
   */
  async deregister(serviceId: string): Promise<void> {
    const existing = this.services[serviceId];
    if (!existing) {
      throw new NotFoundError(`Service '${serviceId}' is not registered`);
    }

    const previousEntry = { ...existing };

    delete this.services[serviceId];
    this.removeServiceFromIndexes(previousEntry);
    this.syncMetricsGauge();

    // Remove from Redis with strict timeout; Postgres removal is part of the
    // same strict operation when dual-write is enabled.
    try {
      await this.removeRegistryEntryStrict(serviceId, { previousEntry });
    } catch (err) {
      this.services[serviceId] = previousEntry;
      this.reindexService(previousEntry);
      this.syncMetricsGauge();
      throw err;
    }

    this.logger.info("Service deregistered", { serviceId });
  }

  // -------------------------------------------------------------------------
  // Lifecycle management
  // -------------------------------------------------------------------------

  /**
   * Mark a service as deprecated. It remains routable but consumers receive
   * sunset warnings in proxy response headers.
   */
  async deprecate(
    serviceId: string,
    sunsetDate?: string,
    replacementService?: string,
  ): Promise<ServiceRegistryEntry> {
    const entry = this.services[serviceId];
    if (!entry) {
      throw new NotFoundError(`Service '${serviceId}' is not registered`);
    }
    if (entry.status === "retired") {
      throw new ConflictError(`Service '${serviceId}' is already retired`);
    }

    const previousEntry = { ...entry };
    const updatedEntry: ServiceRegistryEntry = {
      ...entry,
      status: "deprecated",
      updatedAt: new Date().toISOString(),
      ...(sunsetDate ? { sunsetDate } : {}),
      ...(replacementService ? { replacementService } : {}),
    };

    this.services[serviceId] = updatedEntry;
    this.syncMetricsGauge();

    try {
      await this.persistRegistryEntryStrict(serviceId, updatedEntry, {
        previousEntry,
      });
    } catch (err) {
      this.services[serviceId] = previousEntry;
      this.syncMetricsGauge();
      throw err;
    }

    this.logger.warn(
      `Service '${serviceId}' deprecated (sunset: ${sunsetDate || "unset"}, replacement: ${replacementService || "none"})`,
      "RegistryService",
    );

    return updatedEntry;
  }

  /**
   * Retire a service — it will no longer be routable.
   * Consumers calling this service will receive 410 Gone.
   */
  async retire(serviceId: string): Promise<ServiceRegistryEntry> {
    const entry = this.services[serviceId];
    if (!entry) {
      throw new NotFoundError(`Service '${serviceId}' is not registered`);
    }

    const previousEntry = { ...entry };
    const updatedEntry: ServiceRegistryEntry = {
      ...entry,
      status: "retired",
      updatedAt: new Date().toISOString(),
    };

    this.services[serviceId] = updatedEntry;
    this.syncMetricsGauge();

    try {
      await this.persistRegistryEntryStrict(serviceId, updatedEntry, {
        previousEntry,
      });
    } catch (err) {
      this.services[serviceId] = previousEntry;
      this.syncMetricsGauge();
      throw err;
    }

    this.logger.warn(
      `Service '${serviceId}' retired — no longer routable`,
      "RegistryService",
    );

    return updatedEntry;
  }

  /**
   * Transition a proposed service to active.
   */
  async activate(serviceId: string): Promise<ServiceRegistryEntry> {
    const entry = this.services[serviceId];
    if (!entry) {
      throw new NotFoundError(`Service '${serviceId}' is not registered`);
    }
    if (entry.status !== "proposed" && entry.status !== "deprecated") {
      throw new ConflictError(
        `Service '${serviceId}' is '${entry.status}' and cannot be activated`,
      );
    }

    const previousEntry = { ...entry };
    const updatedEntry: ServiceRegistryEntry = {
      ...entry,
      status: "active",
      updatedAt: new Date().toISOString(),
      sunsetDate: undefined,
      replacementService: undefined,
    };

    this.services[serviceId] = updatedEntry;
    this.syncMetricsGauge();

    try {
      await this.persistRegistryEntryStrict(serviceId, updatedEntry, {
        previousEntry,
      });
    } catch (err) {
      this.services[serviceId] = previousEntry;
      this.syncMetricsGauge();
      throw err;
    }

    this.logger.info(`Service '${serviceId}' activated`, {});
    return updatedEntry;
  }

  /**
   * Check whether a service is currently routable.
   * A service is routable if it is active or deprecated AND healthy.
   */
  isRoutable(serviceId: string): boolean {
    const entry = this.services[serviceId];
    if (!entry) return false;
    if (entry.healthy === false) return false;
    return entry.status === "active" || entry.status === "deprecated";
  }

  /**
   * Get consumers — services that list the given serviceId in their consumes array.
   */
  getConsumers(serviceId: string): string[] {
    return [...(this.consumersByTargetServiceId.get(serviceId) ?? [])].sort();
  }

  // -------------------------------------------------------------------------
  // Lookups
  // -------------------------------------------------------------------------

  get(serviceId: string): ServiceRegistryEntry | null {
    return this.services[serviceId] || null;
  }

  getAll(): ServiceRegistryMap {
    return { ...this.services };
  }

  /**
   * Return all entries filtered by serviceType ('shared' or 'tribe').
   * Services without an explicit serviceType default to 'tribe'.
   */
  getByType(type: ServiceType): ServiceRegistryEntry[] {
    return Object.values(this.services).filter(
      (svc) => (svc.serviceType ?? "tribe") === type,
    );
  }

  count(): number {
    return Object.keys(this.services).length;
  }

  // -------------------------------------------------------------------------
  // Access Control
  // -------------------------------------------------------------------------

  getEffectiveOwnerTribeId(serviceId: string): string | undefined {
    return this.services[serviceId]?.ownerTribeId;
  }

  /** Every tribe service owned by a tribe, across all of its projects. */
  getOwnedServices(tribeId: string): ServiceRegistryEntry[] {
    return this.entriesFor(this.servicesByOwnerTribeId.get(tribeId));
  }

  /** Tribe services that belong to one project. */
  getProjectServices(projectId: string): ServiceRegistryEntry[] {
    return this.entriesFor(this.servicesByProjectId.get(projectId));
  }

  /**
   * Services a caller may reach: every tribe service in its own project, plus whatever it lists in
   * consumes. There is no tribe-wide union, so sibling projects need an explicit consumes grant.
   */
  getCallableServiceIds(serviceId: string): string[] {
    const source = this.services[serviceId];
    if (!source) return [];
    const siblings = source.projectId
      ? this.getProjectServices(source.projectId).map((service) => service.serviceId)
      : [];
    return [...new Set([...siblings, ...(source.consumes ?? [])])];
  }

  getDeveloperPortalServices(serviceId: string) {
    const safeService = (service: ServiceRegistryEntry) => ({
      serviceId: service.serviceId,
      name: service.name,
      serviceType: service.serviceType ?? "tribe",
      projectId: service.projectId ?? null,
      routes: service.exposes ?? [],
      scopes: service.requiredScopes ?? [],
      status: service.status,
      version: service.version,
      description: service.description,
      serviceTier: service.serviceTier,
      contact: service.contact,
    });
    const source = this.services[serviceId];

    return {
      serviceId,
      projectId: source?.projectId ?? null,
      tribeId: source?.ownerTribeId ?? null,
      ownedServices: source?.projectId
        ? this.getProjectServices(source.projectId).map(safeService)
        : [],
      allowedServices: (source?.consumes ?? [])
        .map((serviceId) => this.services[serviceId])
        .filter((service): service is ServiceRegistryEntry => Boolean(service))
        .map(safeService),
    };
  }

  /**
   * Whether one service may call another.
   *  - a tribe target in the caller's own project: allowed;
   *  - a target the caller lists in consumes: allowed;
   *  - anything else, including other projects of the same tribe: denied.
   */
  canAccess(sourceServiceId: string, targetServiceId: string): boolean {
    const source = this.services[sourceServiceId];
    const target = this.services[targetServiceId];
    if (!source || !target) return false;

    if (
      (target.serviceType ?? "tribe") === "tribe" &&
      source.projectId !== undefined &&
      target.projectId === source.projectId
    ) {
      return true;
    }

    return (source.consumes ?? []).includes(targetServiceId);
  }

  private entriesFor(ids: Set<string> | undefined): ServiceRegistryEntry[] {
    return [...(ids ?? [])]
      .map((serviceId) => this.services[serviceId])
      .filter((service): service is ServiceRegistryEntry => Boolean(service))
      .sort((a, b) => a.serviceId.localeCompare(b.serviceId));
  }

  getRequiredScopes(targetServiceId: string): string[] {
    const target = this.services[targetServiceId];
    if (!target) return [];
    return target.requiredScopes;
  }

  // -------------------------------------------------------------------------
  // Proxy resolution
  // -------------------------------------------------------------------------

  resolveUpstream(serviceId: string, path: string): string | null {
    const service = this.services[serviceId];
    if (!service) return null;
    return `${service.baseUrl}${path}`;
  }

  resolveEnvironment(
    serviceId: string,
    environment: ServiceEnvironmentKey = "test",
  ): ServiceEnvironmentManifest | null {
    const service = this.services[serviceId];
    if (!service) return null;

    const environments = normalizeServiceEnvironments(service, {
      status: service.status,
    });

    return (
      environments.find((candidate) => candidate.environment === environment) ??
      environments.find((candidate) => candidate.environment === "test") ??
      environments[0] ??
      null
    );
  }

  // -------------------------------------------------------------------------
  // Secret validation
  // -------------------------------------------------------------------------

  async validateEnvironmentSecret(
    serviceId: string,
    secret: string,
    environment: ApicenterRuntimeEnvironment,
  ): Promise<boolean> {
    return this.serviceSecretResolver.validateEnvironmentSecret(
      serviceId,
      secret,
      environment,
    );
  }

  // -------------------------------------------------------------------------
  // Health status (called by HealthMonitorService)
  // -------------------------------------------------------------------------

  /**
   * Update the runtime health flag on a service entry.
   * Returns `true` if the health status actually **changed** (for event emission).
   */
  setHealthStatus(serviceId: string, healthy: boolean): boolean {
    const entry = this.services[serviceId];
    if (!entry) return false;

    const previous = entry.healthy ?? true; // default is healthy
    if (previous === healthy) return false; // no change

    entry.healthy = healthy;
    entry.lastHealthCheckAt = new Date().toISOString();
    entry.updatedAt = entry.lastHealthCheckAt;

    // Best-effort health persistence should not block callers.
    this.persistToRedis(serviceId, entry).catch((err) => {
      this.logger.warn(
        `Redis persist failed for health update '${serviceId}': ${(err as Error).message}`,
        "RegistryService",
      );
    });
    this.persistHealthToPostgresIfEnabled(entry).catch((err) => {
      this.logger.warn(
        `Postgres persist failed for health update '${serviceId}': ${(err as Error).message}`,
        "RegistryService",
      );
    });

    return true;
  }

  /**
   * Mark the `lastHealthCheckAt` timestamp without changing the healthy flag.
   */
  touchHealthCheck(serviceId: string): void {
    const entry = this.services[serviceId];
    if (entry) {
      entry.lastHealthCheckAt = new Date().toISOString();
    }
  }

  // -------------------------------------------------------------------------
  // Bulk seeding
  // -------------------------------------------------------------------------

  seed(manifests: ServiceManifest[]): void {
    for (const manifest of manifests) {
      // Seed uses fire-and-forget style; persistence failures are handled in register().
      this.register(manifest).catch((err) => {
        this.logger.warn(
          `Seed failed for '${manifest.serviceId}': ${(err as Error).message}`,
          "RegistryService",
        );
      });
    }
    this.logger.info(`Registry seeded with ${manifests.length} service(s)`, {});
  }

  // -------------------------------------------------------------------------
  // Version governance (private)
  // -------------------------------------------------------------------------

  /**
   * Validate that a version upgrade follows semver rules.
   * Prevents major-version downgrades without explicit re-registration.
   */
  private validateVersionUpgrade(
    currentVersion: string,
    newVersion: string,
  ): void {
    const parseSemver = (v: string) => {
      const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
      if (!match) return null;
      return {
        major: Number.parseInt(match[1]),
        minor: Number.parseInt(match[2]),
        patch: Number.parseInt(match[3]),
      };
    };

    const current = parseSemver(currentVersion);
    const next = parseSemver(newVersion);

    if (!current || !next) return; // Skip validation if versions aren't semver

    if (next.major < current.major) {
      throw new ValidationError(
        `Version downgrade from ${currentVersion} to ${newVersion} is not allowed. ` +
          `Deregister the service first if you need to roll back a major version.`,
      );
    }
  }

  private reindexService(
    entry: ServiceRegistryEntry,
    previous?: ServiceRegistryEntry,
  ): void {
    if (previous) {
      this.removeServiceFromIndexes(previous);
    }

    if ((entry.serviceType ?? "tribe") === "tribe") {
      if (entry.ownerTribeId) {
        this.addIndexedValue(this.servicesByOwnerTribeId, entry.ownerTribeId, entry.serviceId);
      }
      if (entry.projectId) {
        this.addIndexedValue(this.servicesByProjectId, entry.projectId, entry.serviceId);
      }
    }

    for (const targetServiceId of entry.consumes ?? []) {
      this.addIndexedValue(
        this.consumersByTargetServiceId,
        targetServiceId,
        entry.serviceId,
      );
    }
  }

  private removeServiceFromIndexes(entry: ServiceRegistryEntry): void {
    if (entry.ownerTribeId) {
      this.removeIndexedValue(this.servicesByOwnerTribeId, entry.ownerTribeId, entry.serviceId);
    }
    if (entry.projectId) {
      this.removeIndexedValue(this.servicesByProjectId, entry.projectId, entry.serviceId);
    }

    for (const targetServiceId of entry.consumes ?? []) {
      this.removeIndexedValue(
        this.consumersByTargetServiceId,
        targetServiceId,
        entry.serviceId,
      );
    }
  }

  private addIndexedValue(
    index: Map<string, Set<string>>,
    key: string,
    value: string,
  ): void {
    const values = index.get(key) ?? new Set<string>();
    values.add(value);
    index.set(key, values);
  }

  private removeIndexedValue(
    index: Map<string, Set<string>>,
    key: string,
    value: string,
  ): void {
    const values = index.get(key);
    if (!values) return;
    values.delete(value);
    if (values.size === 0) {
      index.delete(key);
    }
  }

  private rebuildRegistryIndexes(): void {
    this.servicesByOwnerTribeId.clear();
    this.servicesByProjectId.clear();
    this.consumersByTargetServiceId.clear();

    for (const entry of Object.values(this.services)) {
      this.reindexService(entry);
    }

    const unplaced = Object.values(this.services).filter(
      (entry) => (entry.serviceType ?? "tribe") === "tribe" && !entry.projectId,
    );
    if (unplaced.length > 0) {
      this.logger.error(
        `Registry holds ${unplaced.length} tribe service(s) without a project; run scripts/migrate-tenancy-hierarchy.ts: ${unplaced.map((entry) => entry.serviceId).join(", ")}`,
        undefined,
        "RegistryService",
      );
    }
  }

  // -------------------------------------------------------------------------
  // Metrics sync (private)
  // -------------------------------------------------------------------------

  private syncMetricsGauge(): void {
    const activeCount = Object.values(this.services).filter(
      (s) => s.status === "active" || s.status === "deprecated",
    ).length;
    this.metrics.setRegistryServicesCount(activeCount);

    const statusCounts = {
      proposed: 0,
      active: 0,
      deprecated: 0,
      retired: 0,
    };

    for (const service of Object.values(this.services)) {
      statusCounts[service.status] += 1;
    }

    this.metrics.setRegistryServicesCountByStatus(
      "proposed",
      statusCounts.proposed,
    );
    this.metrics.setRegistryServicesCountByStatus(
      "active",
      statusCounts.active,
    );
    this.metrics.setRegistryServicesCountByStatus(
      "deprecated",
      statusCounts.deprecated,
    );
    this.metrics.setRegistryServicesCountByStatus(
      "retired",
      statusCounts.retired,
    );
  }

  // -------------------------------------------------------------------------
  // Redis persistence (private & public helpers)
  // -------------------------------------------------------------------------

  /**
   * Load all service entries from Redis into the in-memory Map.
   * Called during onModuleInit and by the reconciliation cron job.
   */
  async loadFromRedis(): Promise<void> {
    if (!this.redis) return;

    const entries = await this.redis.hgetall(REDIS_REGISTRY_KEY);
    let count = 0;

    for (const [serviceId, json] of Object.entries(entries)) {
      try {
        const entry: ServiceRegistryEntry = normalizeRegistryEntry(
          JSON.parse(json),
        );
        this.services[serviceId] = entry;
        count++;
      } catch (err) {
        this.logger.warn(
          `Failed to parse Redis registry entry for '${serviceId}': ${(err as Error).message}`,
          "RegistryService",
        );
      }
    }

    if (count > 0) {
      this.logger.info(`Registry hydrated ${count} service(s) from Redis`, {});
    }
    this.rebuildRegistryIndexes();
  }

  /**
   * Load all service entries from Postgres into the in-memory map.
   * Used only after REGISTRY_SOURCE=postgres is explicitly enabled.
   */
  async loadFromPostgres(): Promise<void> {
    if (!this.config.database.enabled) {
      throw new Error(
        "DATABASE_ENABLED=true is required to load registry from Postgres",
      );
    }
    if (!this.postgresStore) {
      throw new Error("Postgres registry store is not available");
    }

    const entries = await this.postgresStore.loadAll();
    for (const [serviceId, entry] of Object.entries(entries)) {
      this.services[serviceId] = entry;
    }
    this.rebuildRegistryIndexes();
    this.syncMetricsGauge();

    const count = Object.keys(entries).length;
    if (count > 0) {
      this.logger.info(
        `Registry hydrated ${count} service(s) from Postgres`,
        {},
      );
    }
  }

  /**
   * Return the raw Redis hash entries for drift comparison.
   * Returns `null` when Redis is unavailable.
   */
  async getRedisEntries(): Promise<Record<
    string,
    ServiceRegistryEntry
  > | null> {
    if (!this.redis) return null;

    const raw = await this.redis.hgetall(REDIS_REGISTRY_KEY);
    const entries: Record<string, ServiceRegistryEntry> = {};

    for (const [serviceId, json] of Object.entries(raw)) {
      try {
        entries[serviceId] = normalizeRegistryEntry(JSON.parse(json));
      } catch {
        this.logger.warn(
          `Failed to parse Redis entry for '${serviceId}' during drift check`,
          "RegistryService",
        );
      }
    }
    return entries;
  }

  /**
   * Persist a single service entry to Redis.
   */
  private async persistToRedis(
    serviceId: string,
    entry: ServiceRegistryEntry,
  ): Promise<void> {
    if (!this.redis) return;
    await this.redis.hset(REDIS_REGISTRY_KEY, serviceId, JSON.stringify(entry));
  }

  private shouldWritePostgres(): boolean {
    return (
      this.config.database.enabled &&
      this.config.database.dualWrite &&
      !!this.postgresStore
    );
  }

  private async persistToPostgresIfEnabled(
    entry: ServiceRegistryEntry,
  ): Promise<void> {
    if (!this.shouldWritePostgres()) return;
    await this.postgresStore!.upsert(entry);
  }

  private async persistHealthToPostgresIfEnabled(
    entry: ServiceRegistryEntry,
  ): Promise<void> {
    if (!this.shouldWritePostgres()) return;
    await this.postgresStore!.updateHealthStatus(entry);
  }

  private async removeFromPostgresIfEnabled(serviceId: string): Promise<void> {
    if (!this.shouldWritePostgres()) return;
    await this.postgresStore!.remove(serviceId);
  }

  private async persistRegistryEntryStrict(
    serviceId: string,
    entry: ServiceRegistryEntry,
    options: { previousEntry: ServiceRegistryEntry | null },
  ): Promise<void> {
    await this.persistToRedisStrict(serviceId, entry);

    try {
      await this.persistToPostgresIfEnabled(entry);
    } catch (err) {
      await this.rollbackRedisAfterPostgresFailure(
        serviceId,
        options.previousEntry,
      );
      throw new Error(
        `Registry Postgres write failed for '${serviceId}': ${(err as Error).message}`,
      );
    }
  }

  private async removeRegistryEntryStrict(
    serviceId: string,
    options: { previousEntry: ServiceRegistryEntry },
  ): Promise<void> {
    await this.removeFromRedisStrict(serviceId);

    try {
      await this.removeFromPostgresIfEnabled(serviceId);
    } catch (err) {
      await this.persistToRedisStrict(serviceId, options.previousEntry);
      throw new Error(
        `Registry Postgres remove failed for '${serviceId}': ${(err as Error).message}`,
      );
    }
  }

  private async rollbackRedisAfterPostgresFailure(
    serviceId: string,
    previousEntry: ServiceRegistryEntry | null,
  ): Promise<void> {
    if (previousEntry) {
      await this.persistToRedisStrict(serviceId, previousEntry);
    } else {
      await this.removeFromRedisStrict(serviceId);
    }
  }

  /**
   * Remove a single service entry from Redis.
   */
  private async removeFromRedis(serviceId: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.hdel(REDIS_REGISTRY_KEY, serviceId);
  }

  /**
   * Persist to Redis with a hard timeout. Throws if the write takes longer
   * than `REDIS_WRITE_TIMEOUT_MS` or if Redis is unavailable.
   */
  private async persistToRedisStrict(
    serviceId: string,
    entry: ServiceRegistryEntry,
  ): Promise<void> {
    if (!this.redis) {
      this.logger.warn(
        `Redis unavailable — registration for '${serviceId}' persisted in-memory only`,
        "RegistryService",
      );
      return;
    }

    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(`Redis write timed out after ${REDIS_WRITE_TIMEOUT_MS}ms`),
        );
      }, REDIS_WRITE_TIMEOUT_MS);
    });

    try {
      await Promise.race([
        this.redis.hset(REDIS_REGISTRY_KEY, serviceId, JSON.stringify(entry)),
        timeout,
      ]);
    } catch (err) {
      throw new Error(
        `Registration for '${serviceId}' failed — Redis write error: ${(err as Error).message}`,
      );
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /**
   * Remove from Redis with a hard timeout. Throws on failure.
   */
  private async removeFromRedisStrict(serviceId: string): Promise<void> {
    if (!this.redis) {
      this.logger.warn(
        `Redis unavailable — deregistration for '${serviceId}' applied in-memory only`,
        "RegistryService",
      );
      return;
    }

    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new Error(`Redis delete timed out after ${REDIS_WRITE_TIMEOUT_MS}ms`),
        );
      }, REDIS_WRITE_TIMEOUT_MS);
    });

    try {
      await Promise.race([
        this.redis.hdel(REDIS_REGISTRY_KEY, serviceId),
        timeout,
      ]);
    } catch (err) {
      throw new Error(
        `Deregistration for '${serviceId}' failed — Redis delete error: ${(err as Error).message}`,
      );
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
