// =============================================================================
// src/registry/registry.service.ts — Dynamic Service Registry (NestJS)
// =============================================================================
// The heart of the "Dynamic Service Registry" platform. Services register
// themselves at runtime by POSTing a ServiceManifest.
//
// Postgres is authoritative when DATABASE_URL is configured. The in-memory
// map is a local read cache; mutations commit to Postgres before becoming
// visible here, and periodic refresh keeps other gateway instances current.
// Without a database, local development and tests use memory only.
// =============================================================================

import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from "@nestjs/common";
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
import { createRegistryEntry } from "./manifest-normalizer";

const REGISTRY_REFRESH_INTERVAL_MS = 25_000;

@Injectable()
export class RegistryService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly services: ServiceRegistryMap = {};
  private readonly servicesByOwnerTribeId = new Map<string, Set<string>>();
  private readonly servicesByProjectId = new Map<string, Set<string>>();
  private readonly consumersByTargetServiceId = new Map<string, Set<string>>();
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshing: Promise<void> | null = null;
  private writesInFlight = 0;
  private localMutationVersion = 0;
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
    if (this.config.database.enabled) {
      await this.loadFromPostgres();
    }
  }

  onApplicationBootstrap(): void {
    if (!this.config.database.enabled) return;
    this.refreshTimer = setInterval(
      () => void this.refreshFromPostgres(),
      REGISTRY_REFRESH_INTERVAL_MS,
    );
    this.refreshTimer.unref();
  }

  async onModuleDestroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
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
   * Persists to Postgres first when configured, then updates the local cache.
   * Validates semver on updates and tracks version changes.
   *
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

    await this.persistEntry(entry);
    this.replaceEntry(entry, existing);

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
   * Persists removal to Postgres before removing it from the local cache.
   */
  async deregister(serviceId: string): Promise<void> {
    const existing = this.services[serviceId];
    if (!existing) {
      throw new NotFoundError(`Service '${serviceId}' is not registered`);
    }

    const retiredEntry: ServiceRegistryEntry = {
      ...existing,
      status: "retired",
      updatedAt: new Date().toISOString(),
    };
    await this.removePersistedEntry(serviceId);
    this.replaceEntry(retiredEntry, existing);

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

    await this.persistEntry(updatedEntry);
    this.replaceEntry(updatedEntry, previousEntry);

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

    await this.persistEntry(updatedEntry);
    this.replaceEntry(updatedEntry, previousEntry);

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

    await this.persistEntry(updatedEntry);
    this.replaceEntry(updatedEntry, previousEntry);

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
  async setHealthStatus(serviceId: string, healthy: boolean): Promise<boolean> {
    const entry = this.services[serviceId];
    if (!entry) return false;

    const previous = entry.healthy ?? true; // default is healthy
    if (previous === healthy) return false; // no change

    const now = new Date().toISOString();
    const updated: ServiceRegistryEntry = {
      ...entry,
      healthy,
      lastHealthCheckAt: now,
      updatedAt: now,
    };
    this.replaceEntry(updated, entry);

    try {
      await this.persistHealthStatus(updated);
    } catch (err) {
      this.logger.warn(
        `Failed to persist health status for '${serviceId}': ${(err as Error).message}`,
        "RegistryService",
      );
    }

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
        `Registry holds ${unplaced.length} tribe service(s) without a project: ${unplaced.map((entry) => entry.serviceId).join(", ")}`,
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
  // Postgres persistence and bounded cross-instance refresh
  // -------------------------------------------------------------------------

  /**
   * Load all service entries from Postgres into the in-memory map.
   * Startup fails when Postgres is configured but cannot provide the registry.
   */
  async loadFromPostgres(): Promise<void> {
    if (!this.config.database.enabled) {
      throw new Error(
        "DATABASE_URL is required to load registry from Postgres",
      );
    }
    if (!this.postgresStore) {
      throw new Error("Postgres registry store is not available");
    }

    const entries = await this.postgresStore.loadAll();
    this.replaceAllEntries(entries, false);

    const count = Object.keys(entries).length;
    if (count > 0) {
      this.logger.info(
        `Registry hydrated ${count} service(s) from Postgres`,
        {},
      );
    }
  }

  async refreshFromPostgres(): Promise<void> {
    if (!this.config.database.enabled || !this.postgresStore) return;
    if (this.refreshing) return this.refreshing;

    const versionAtStart = this.localMutationVersion;
    if (this.writesInFlight > 0) return;

    this.refreshing = (async () => {
      try {
        const entries = await this.postgresStore!.loadAll();
        if (
          this.writesInFlight > 0 ||
          this.localMutationVersion !== versionAtStart
        ) {
          return;
        }
        this.replaceAllEntries(entries, true);
      } catch (err) {
        this.logger.warn(
          `Registry refresh failed; retaining the current snapshot: ${(err as Error).message}`,
          "RegistryService",
        );
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async persistEntry(entry: ServiceRegistryEntry): Promise<void> {
    if (!this.config.database.enabled) return;
    if (!this.postgresStore) throw new Error("Postgres registry store is not available");
    this.writesInFlight += 1;
    try {
      await this.postgresStore.upsert(entry);
    } finally {
      this.writesInFlight -= 1;
    }
  }

  private async persistHealthStatus(entry: ServiceRegistryEntry): Promise<void> {
    if (!this.config.database.enabled) return;
    if (!this.postgresStore) throw new Error("Postgres registry store is not available");
    this.writesInFlight += 1;
    try {
      await this.postgresStore.updateHealthStatus(entry);
    } finally {
      this.writesInFlight -= 1;
    }
  }

  private async removePersistedEntry(serviceId: string): Promise<void> {
    if (!this.config.database.enabled) return;
    if (!this.postgresStore) throw new Error("Postgres registry store is not available");
    this.writesInFlight += 1;
    try {
      await this.postgresStore.remove(serviceId);
    } finally {
      this.writesInFlight -= 1;
    }
  }

  private replaceEntry(
    entry: ServiceRegistryEntry,
    previous?: ServiceRegistryEntry,
  ): void {
    this.services[entry.serviceId] = entry;
    this.reindexService(entry, previous);
    this.localMutationVersion += 1;
    this.syncMetricsGauge();
    this.notifyCacheInvalidation(entry.serviceId);
  }

  private replaceAllEntries(entries: ServiceRegistryMap, notify: boolean): void {
    const previous = this.services;
    const changedServiceIds = new Set<string>();
    for (const serviceId of new Set([...Object.keys(previous), ...Object.keys(entries)])) {
      if (JSON.stringify(previous[serviceId]) !== JSON.stringify(entries[serviceId])) {
        changedServiceIds.add(serviceId);
      }
    }

    for (const serviceId of Object.keys(this.services)) delete this.services[serviceId];
    Object.assign(this.services, entries);
    this.rebuildRegistryIndexes();
    this.syncMetricsGauge();
    if (notify) {
      for (const serviceId of changedServiceIds) this.notifyCacheInvalidation(serviceId);
    }
  }
}
