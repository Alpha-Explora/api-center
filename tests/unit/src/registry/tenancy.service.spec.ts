import { TenancyService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/tenancy.service";
import type { PostgresTenancyStoreService } from "../../../../apps/gateway/src/domains/catalog-registry/registry/postgres-tenancy-store.service";
import { ConfigService } from "../../../../apps/gateway/src/config/config.service";
import { LoggerService } from "../../../../apps/gateway/src/shared/logger.service";
import { ConflictError, ValidationError } from "../../../../apps/gateway/src/shared/errors";

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;

function config(database: Record<string, unknown> = {}) {
  return {
    redis: { cacheUrl: "" },
    database: { enabled: false, registrySource: "redis", dualWrite: false, ...database },
  } as unknown as ConfigService;
}

describe("TenancyService", () => {
  let tenancy: TenancyService;

  beforeEach(async () => {
    tenancy = new TenancyService(logger, config());
    await tenancy.createTribe({ tribeId: "alphaci", name: "AlphaCI" });
  });

  it("creates projects inside a tribe and lists them per tribe", async () => {
    await tenancy.createProject({ projectId: "alphaci-billing", tribeId: "alphaci", name: "Billing", costCenter: "FIN-1" });
    await tenancy.createProject({ projectId: "alphaci-lms", tribeId: "alphaci", name: "LMS" });

    expect(tenancy.listProjects({ tribeId: "alphaci" }).map((project) => project.projectId)).toEqual([
      "alphaci-billing",
      "alphaci-lms",
    ]);
    expect(tenancy.resolveProject("alphaci-billing")).toMatchObject({
      tribe: { tribeId: "alphaci" },
      project: { projectId: "alphaci-billing", costCenter: "FIN-1", status: "active" },
    });
  });

  it("rejects invalid ids, duplicates, and projects in unknown or suspended tribes", async () => {
    await expect(tenancy.createTribe({ tribeId: "Bad Tribe", name: "x" })).rejects.toThrow(ValidationError);
    await expect(tenancy.createTribe({ tribeId: "alphaci", name: "again" })).rejects.toThrow(ConflictError);
    await expect(
      tenancy.createProject({ projectId: "orphan", tribeId: "missing", name: "Orphan" }),
    ).rejects.toThrow("Tribe 'missing' is not registered");

    await tenancy.updateTribe("alphaci", { status: "suspended" });
    await expect(
      tenancy.createProject({ projectId: "alphaci-new", tribeId: "alphaci", name: "New" }),
    ).rejects.toThrow("Tribe 'alphaci' is suspended");
  });

  it("explains why a project cannot host services", async () => {
    await tenancy.createProject({ projectId: "alphaci-billing", tribeId: "alphaci", name: "Billing" });

    expect(() => tenancy.requireActiveProject(undefined)).toThrow("projectId is required for tribe services");
    expect(() => tenancy.requireActiveProject("nope")).toThrow("Project 'nope' is not registered");

    await tenancy.updateProject("alphaci-billing", { status: "archived" });
    expect(() => tenancy.requireActiveProject("alphaci-billing")).toThrow("Project 'alphaci-billing' is archived");

    await tenancy.updateProject("alphaci-billing", { status: "active" });
    await tenancy.updateTribe("alphaci", { status: "suspended" });
    expect(() => tenancy.requireActiveProject("alphaci-billing")).toThrow("Tribe 'alphaci' is suspended");
  });

  it("seeds idempotently", async () => {
    const seed = {
      tribes: [{ tribeId: "alphaci", name: "AlphaCI" }, { tribeId: "campusone", name: "CampusOne" }],
      projects: [{ projectId: "campusone-core", tribeId: "campusone", name: "Core" }],
    };

    await expect(tenancy.seed(seed)).resolves.toEqual({ tribes: 1, projects: 1 });
    await expect(tenancy.seed(seed)).resolves.toEqual({ tribes: 0, projects: 0 });
  });

  it("writes Postgres before the tribe or project becomes visible in memory", async () => {
    const visibleDuringWrite: boolean[] = [];
    let durable: TenancyService;
    const store = {
      upsertTribe: jest.fn(async () => {
        visibleDuringWrite.push(durable.getTribe("durable") !== null);
      }),
      upsertProject: jest.fn(async () => {
        visibleDuringWrite.push(durable.getProject("durable-core") !== null);
      }),
      loadAll: jest.fn(),
    } as unknown as PostgresTenancyStoreService;
    durable = new TenancyService(logger, config({ enabled: true, dualWrite: true }), store);

    await durable.createTribe({ tribeId: "durable", name: "Durable" });
    await durable.createProject({ projectId: "durable-core", tribeId: "durable", name: "Core" });

    expect(visibleDuringWrite).toEqual([false, false]);
    expect(durable.getProject("durable-core")).not.toBeNull();
  });

  it("does not record a tribe in memory when the Postgres write fails", async () => {
    const store = {
      upsertTribe: jest.fn().mockRejectedValue(new Error("db down")),
      upsertProject: jest.fn(),
      loadAll: jest.fn(),
    } as unknown as PostgresTenancyStoreService;
    const durable = new TenancyService(logger, config({ enabled: true, registrySource: "postgres" }), store);

    await expect(durable.createTribe({ tribeId: "durable", name: "Durable" })).rejects.toThrow("db down");
    expect(durable.getTribe("durable")).toBeNull();
  });

  describe("sharing the directory across gateway instances", () => {
    const now = "2026-10-08T00:00:00.000Z";
    const tribe = (status: "active" | "suspended" = "active") => ({
      tribeId: "shared", name: "Shared", status, createdAt: now, updatedAt: now,
    });
    const project = { projectId: "shared-core", tribeId: "shared", name: "Core", status: "active" as const, createdAt: now, updatedAt: now };

    function instance(snapshot: () => { tribes: unknown[]; projects: unknown[] }) {
      const store = {
        loadAll: jest.fn(async () => snapshot()),
        upsertTribe: jest.fn(),
        upsertProject: jest.fn(),
      } as unknown as PostgresTenancyStoreService;
      return new TenancyService(logger, config({ enabled: true, registrySource: "postgres" }), store);
    }

    it("finds a project that another instance created", async () => {
      let stored: { tribes: unknown[]; projects: unknown[] } = { tribes: [tribe()], projects: [] };
      const local = instance(() => stored);
      await local.refresh();
      expect(local.resolveProject("shared-core")).toBeNull();

      stored = { tribes: [tribe()], projects: [project] };
      await local.refreshIfMissing("shared-core");

      expect(local.requireActiveProject("shared-core").project.projectId).toBe("shared-core");
    });

    it("picks up a tribe suspended on another instance", async () => {
      let stored: { tribes: unknown[]; projects: unknown[] } = { tribes: [tribe()], projects: [project] };
      const local = instance(() => stored);
      await local.refresh();
      expect(() => local.requireActiveProject("shared-core")).not.toThrow();

      stored = { tribes: [tribe("suspended")], projects: [project] };
      await local.refresh();

      expect(() => local.requireActiveProject("shared-core")).toThrow("Tribe 'shared' is suspended");
    });

    it("keeps the current directory when the store is unreachable or returns nothing", async () => {
      let stored: { tribes: unknown[]; projects: unknown[] } | Error = { tribes: [tribe()], projects: [project] };
      const local = instance(() => {
        if (stored instanceof Error) throw stored;
        return stored;
      });
      await local.refresh();

      stored = new Error("db down");
      await local.refresh();
      expect(local.getProject("shared-core")).not.toBeNull();

      stored = { tribes: [], projects: [] };
      await local.refresh();
      expect(local.getProject("shared-core")).not.toBeNull();
    });
  });
});
