// =============================================================================
// Tenancy directory: tribes and projects.
// =============================================================================
// Storage mirrors the service registry so the two never run in different modes:
//   memory (hot reads) -> Redis hash (shared across instances) -> Postgres when the database is the
//   registry source or dual-write is enabled. Postgres is written first so the services table's
//   composite foreign key always finds its project.
// =============================================================================

import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import Redis from "ioredis";
import { ConfigService } from "@config/config.service";
import { LoggerService } from "@shared/logger.service";
import { ConflictError, NotFoundError, ValidationError } from "@shared/errors";
import { PostgresTenancyStoreService } from "./postgres-tenancy-store.service";
import {
  CreateProjectInput,
  CreateTribeInput,
  Project,
  PROJECT_ID_PATTERN,
  ProjectPlacement,
  TENANCY_STATUSES,
  TenancySeed,
  TenancyStatus,
  Tribe,
  TRIBE_ID_PATTERN,
  UpdateProjectInput,
  UpdateTribeInput,
} from "./tenancy.types";

const REDIS_TRIBES_KEY = "api-center:tenancy:tribes";
const REDIS_PROJECTS_KEY = "api-center:tenancy:projects";
const REDIS_WRITE_TIMEOUT_MS = 2_000;
const DEFAULT_REFRESH_SECONDS = 10;

@Injectable()
export class TenancyService implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy {
  private readonly tribes = new Map<string, Tribe>();
  private readonly projects = new Map<string, Project>();
  private readonly projectsByTribe = new Map<string, Set<string>>();
  private redis: Redis | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshing: Promise<void> | null = null;
  private writesInFlight = 0;

  constructor(
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
    @Optional() private readonly postgresStore?: PostgresTenancyStoreService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.redis = new Redis(this.config.redis.cacheUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 3000),
      });
      await this.redis.connect();
    } catch (err) {
      this.logger.warn(
        `Tenancy Redis unavailable; running in memory-only mode: ${(err as Error).message}`,
        "TenancyService",
      );
      this.redis = null;
    }

    if (this.config.database.registrySource === "postgres") {
      await this.loadFromPostgres();
      return;
    }

    try {
      await this.loadFromRedis();
    } catch (err) {
      this.logger.warn(
        `Tenancy Redis load failed; running in memory-only mode: ${(err as Error).message}`,
        "TenancyService",
      );
    }
  }

  /**
   * Gateway instances each hold a copy of the directory. Re-read the shared store on an interval so a
   * tribe suspended or a project created on one instance reaches the others within a few seconds.
   */
  onApplicationBootstrap(): void {
    const configured = Number.parseInt(process.env.TENANCY_REFRESH_SECONDS ?? "", 10);
    const seconds = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_REFRESH_SECONDS;
    if (!this.redis && this.config.database.registrySource !== "postgres") return;
    this.refreshTimer = setInterval(() => void this.refresh(), seconds * 1000);
    this.refreshTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
  }

  /** Re-read tribes and projects from the shared store. Keeps the current copy when the store is unreachable. */
  async refresh(): Promise<void> {
    if (this.writesInFlight > 0) return;
    if (!this.refreshing) {
      this.refreshing = (async () => {
        try {
          if (this.config.database.registrySource === "postgres") await this.loadFromPostgres();
          else await this.loadFromRedis();
        } catch (err) {
          this.logger.warn(
            `Tenancy refresh failed; keeping the current directory: ${(err as Error).message}`,
            "TenancyService",
          );
        } finally {
          this.refreshing = null;
        }
      })();
    }
    await this.refreshing;
  }

  /** Look in the shared store when a project is unknown here; another instance may have created it. */
  async refreshIfMissing(projectId: string | undefined): Promise<void> {
    if (projectId && !this.projects.has(projectId)) await this.refresh();
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  listTribes(): Tribe[] {
    return [...this.tribes.values()].sort((a, b) => a.tribeId.localeCompare(b.tribeId));
  }

  getTribe(tribeId: string): Tribe | null {
    return this.tribes.get(tribeId) ?? null;
  }

  listProjects(filter: { tribeId?: string } = {}): Project[] {
    const ids = filter.tribeId
      ? [...(this.projectsByTribe.get(filter.tribeId) ?? [])]
      : [...this.projects.keys()];
    return ids
      .map((id) => this.projects.get(id))
      .filter((project): project is Project => Boolean(project))
      .sort((a, b) => a.projectId.localeCompare(b.projectId));
  }

  getProject(projectId: string): Project | null {
    return this.projects.get(projectId) ?? null;
  }

  /** Project plus its tribe, regardless of status. Null when either is unknown. */
  resolveProject(projectId: string): ProjectPlacement | null {
    const project = this.projects.get(projectId);
    if (!project) return null;
    const tribe = this.tribes.get(project.tribeId);
    return tribe ? { tribe, project } : null;
  }

  /** Project plus its tribe, both active. Throws ValidationError naming what is missing or inactive. */
  requireActiveProject(projectId: string | undefined): ProjectPlacement {
    if (!projectId) {
      throw new ValidationError("projectId is required for tribe services");
    }
    const placement = this.resolveProject(projectId);
    if (!placement) {
      throw new ValidationError(`Project '${projectId}' is not registered`);
    }
    if (placement.tribe.status !== "active") {
      throw new ValidationError(
        `Tribe '${placement.tribe.tribeId}' is ${placement.tribe.status}`,
      );
    }
    if (placement.project.status !== "active") {
      throw new ValidationError(
        `Project '${projectId}' is ${placement.project.status}`,
      );
    }
    return placement;
  }

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------

  async createTribe(input: CreateTribeInput): Promise<Tribe> {
    const tribeId = input.tribeId.trim();
    if (!TRIBE_ID_PATTERN.test(tribeId)) {
      throw new ValidationError("tribeId must be a lowercase slug of 1-64 characters");
    }
    if (this.tribes.has(tribeId)) {
      throw new ConflictError(`Tribe '${tribeId}' already exists`);
    }
    const now = new Date().toISOString();
    const tribe: Tribe = {
      tribeId,
      name: requireName(input.name, "tribe"),
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await this.persistTribe(tribe, null);
    return tribe;
  }

  async updateTribe(tribeId: string, input: UpdateTribeInput): Promise<Tribe> {
    const existing = this.tribes.get(tribeId);
    if (!existing) throw new NotFoundError(`Tribe '${tribeId}' is not registered`);
    const updated: Tribe = {
      ...existing,
      ...(input.name !== undefined ? { name: requireName(input.name, "tribe") } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() || undefined } : {}),
      ...(input.status !== undefined ? { status: requireStatus(input.status) } : {}),
      updatedAt: new Date().toISOString(),
    };
    await this.persistTribe(updated, existing);
    return updated;
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    const projectId = input.projectId.trim();
    if (!PROJECT_ID_PATTERN.test(projectId)) {
      throw new ValidationError("projectId must be a lowercase slug of 1-80 characters");
    }
    if (this.projects.has(projectId)) {
      throw new ConflictError(`Project '${projectId}' already exists`);
    }
    const tribe = this.tribes.get(input.tribeId);
    if (!tribe) throw new ValidationError(`Tribe '${input.tribeId}' is not registered`);
    if (tribe.status !== "active") {
      throw new ValidationError(`Tribe '${tribe.tribeId}' is ${tribe.status}`);
    }
    const now = new Date().toISOString();
    const project: Project = {
      projectId,
      tribeId: tribe.tribeId,
      name: requireName(input.name, "project"),
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      ...(input.costCenter?.trim() ? { costCenter: input.costCenter.trim() } : {}),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await this.persistProject(project, null);
    return project;
  }

  /** tribeId is immutable: moving a project means creating a new one. */
  async updateProject(projectId: string, input: UpdateProjectInput): Promise<Project> {
    const existing = this.projects.get(projectId);
    if (!existing) throw new NotFoundError(`Project '${projectId}' is not registered`);
    const updated: Project = {
      ...existing,
      ...(input.name !== undefined ? { name: requireName(input.name, "project") } : {}),
      ...(input.description !== undefined ? { description: input.description.trim() || undefined } : {}),
      ...(input.costCenter !== undefined ? { costCenter: input.costCenter.trim() || undefined } : {}),
      ...(input.status !== undefined ? { status: requireStatus(input.status) } : {}),
      updatedAt: new Date().toISOString(),
    };
    await this.persistProject(updated, existing);
    return updated;
  }

  /** Idempotent: creates missing tribes and projects, leaves existing ones untouched. */
  async seed(seed: TenancySeed): Promise<{ tribes: number; projects: number }> {
    let tribes = 0;
    let projects = 0;
    for (const tribe of seed.tribes ?? []) {
      if (this.tribes.has(tribe.tribeId)) continue;
      await this.createTribe(tribe);
      tribes += 1;
    }
    for (const project of seed.projects ?? []) {
      if (this.projects.has(project.projectId)) continue;
      await this.createProject(project);
      projects += 1;
    }
    return { tribes, projects };
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  async loadFromRedis(): Promise<void> {
    if (!this.redis) return;
    const [tribes, projects] = await Promise.all([
      this.redis.hgetall(REDIS_TRIBES_KEY),
      this.redis.hgetall(REDIS_PROJECTS_KEY),
    ]);
    this.replaceAll(
      Object.values(tribes).map((json) => JSON.parse(json) as Tribe),
      Object.values(projects).map((json) => JSON.parse(json) as Project),
    );
  }

  async loadFromPostgres(): Promise<void> {
    if (!this.config.database.enabled || !this.postgresStore) {
      throw new Error("DATABASE_ENABLED=true is required to load tenancy from Postgres");
    }
    const snapshot = await this.postgresStore.loadAll();
    this.replaceAll(snapshot.tribes, snapshot.projects);
  }

  private replaceAll(tribes: Tribe[], projects: Project[]): void {
    // A write that started while this snapshot was loading would be overwritten by older data.
    if (this.writesInFlight > 0) return;
    if (tribes.length === 0 && projects.length === 0 && this.tribes.size > 0) {
      this.logger.warn(
        "Tenancy store returned no tribes or projects; keeping the current directory",
        "TenancyService",
      );
      return;
    }
    this.tribes.clear();
    this.projects.clear();
    this.projectsByTribe.clear();
    for (const tribe of tribes) this.tribes.set(tribe.tribeId, tribe);
    for (const project of projects) this.indexProject(project);
    if (tribes.length > 0) {
      this.logger.info(`Tenancy hydrated ${tribes.length} tribe(s), ${projects.length} project(s)`, {});
    }
  }

  private indexProject(project: Project): void {
    this.projects.set(project.projectId, project);
    const ids = this.projectsByTribe.get(project.tribeId) ?? new Set<string>();
    ids.add(project.projectId);
    this.projectsByTribe.set(project.tribeId, ids);
  }

  private shouldWritePostgres(): boolean {
    return (
      this.config.database.enabled &&
      (this.config.database.dualWrite || this.config.database.registrySource === "postgres") &&
      !!this.postgresStore
    );
  }

  private async persistTribe(tribe: Tribe, previous: Tribe | null): Promise<void> {
    this.writesInFlight += 1;
    try {
      if (this.shouldWritePostgres()) await this.postgresStore!.upsertTribe(tribe);
      this.tribes.set(tribe.tribeId, tribe);
      try {
        await this.writeRedis(REDIS_TRIBES_KEY, tribe.tribeId, tribe);
      } catch (err) {
        if (previous) this.tribes.set(previous.tribeId, previous);
        else this.tribes.delete(tribe.tribeId);
        throw err;
      }
      this.logger.info("Tribe saved", { tribeId: tribe.tribeId, status: tribe.status });
    } finally {
      this.writesInFlight -= 1;
    }
  }

  private async persistProject(project: Project, previous: Project | null): Promise<void> {
    this.writesInFlight += 1;
    try {
      if (this.shouldWritePostgres()) await this.postgresStore!.upsertProject(project);
      this.indexProject(project);
      try {
        await this.writeRedis(REDIS_PROJECTS_KEY, project.projectId, project);
      } catch (err) {
        if (previous) this.indexProject(previous);
        else {
          this.projects.delete(project.projectId);
          this.projectsByTribe.get(project.tribeId)?.delete(project.projectId);
        }
        throw err;
      }
      this.logger.info("Project saved", {
        projectId: project.projectId,
        tribeId: project.tribeId,
        status: project.status,
      });
    } finally {
      this.writesInFlight -= 1;
    }
  }

  private async writeRedis(key: string, field: string, value: unknown): Promise<void> {
    if (!this.redis) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.redis.hset(key, field, JSON.stringify(value)),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Redis write timed out for ${key}:${field}`)),
            REDIS_WRITE_TIMEOUT_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

function requireName(value: string, kind: "tribe" | "project"): string {
  const name = value?.trim();
  if (!name) throw new ValidationError(`${kind} name is required`);
  if (name.length > 128) throw new ValidationError(`${kind} name is too long`);
  return name;
}

function requireStatus(value: TenancyStatus): TenancyStatus {
  if (!TENANCY_STATUSES.includes(value)) {
    throw new ValidationError("status must be active, suspended, or archived");
  }
  return value;
}
