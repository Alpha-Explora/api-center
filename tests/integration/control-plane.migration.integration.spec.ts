// The legacy migration lifecycle on a real, migrated PostgreSQL database, running as the
// application role so row-level security applies:
// inventory → backfill (idempotent, revision-checked) → shadow → cutover → control-plane routing
// → rollback rules, plus write fencing in both directions.
// Opt-in: APICENTER_CONTROL_PLANE_TEST_URL (see control-plane.database.integration.spec.ts).

import { generateKeyPairSync, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { loadRuntimeContextKeys, verifyRuntimeContext } from "@apicenter/runtime";
import { PrismaService } from "../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ControlPlaneAdminService } from "../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ApplicationAccessService } from "../../apps/gateway/src/domains/control-plane/application-access.service";
import { RuntimeContextSigner } from "../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { QuotaService } from "../../apps/gateway/src/domains/control-plane/quota.service";
import { LegacyMigrationService } from "../../apps/gateway/src/domains/control-plane/migration/legacy-migration.service";
import { LegacyBridgeService } from "../../apps/gateway/src/domains/control-plane/migration/legacy-bridge.service";
import { assertLegacyRegistryWritable } from "../../apps/gateway/src/domains/control-plane/migration/authority";

const url = process.env.APICENTER_CONTROL_PLANE_TEST_URL;
if (url && !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Refusing a non-local test database");
const describeWithDatabase = url ? describe : describe.skip;

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const runtimeKeys = loadRuntimeContextKeys(JSON.stringify([{ ...publicKey.export({ format: "jwk" }), kid: "k1" }]));
const operator = "platform:migration-test";

describeWithDatabase("legacy migration on PostgreSQL", () => {
  const org = randomUUID();
  const suffix = org.slice(0, 8);
  const tribeId = `commerce-${suffix}`;
  const shop = `shop-${suffix}`;
  const api = `shop-api-${suffix}`;
  const worker = `shop-worker-${suffix}`;
  let pool: Pool;
  let prisma: PrismaService;
  let migration: LegacyMigrationService;
  let bridge: LegacyBridgeService;
  let admin: ControlPlaneAdminService;
  const access = new Set([`${api}->email`, `${api}->${worker}`]);
  const services: Record<string, Record<string, unknown>> = {
    [api]: { serviceId: api, name: "Shop API", serviceType: "tribe", projectId: shop, ownerTribeId: tribeId, status: "active", requiredScopes: [], exposes: [], environments: [{ environment: "test", baseUrl: "https://shop-api.example.com" }] },
    [worker]: { serviceId: worker, name: "Shop worker", serviceType: "tribe", projectId: shop, ownerTribeId: tribeId, status: "active", requiredScopes: [], exposes: ["/jobs/:id"], environments: [{ environment: "test", baseUrl: "https://shop-worker.example.com" }] },
    email: { serviceId: "email", name: "Email", serviceType: "shared", status: "active", requiredScopes: ["email:send"], exposes: [], environments: [{ environment: "test", baseUrl: "https://email.example.com" }] },
  };
  const tribe = { tribeId, organizationId: org, name: "Commerce", status: "active" };
  const project = { projectId: shop, tribeId, name: "Shop", status: "active" };
  const tenancy = {
    getTribe: () => tribe,
    listTribes: () => [tribe],
    listProjects: () => [project],
    resolveProject: (id: string) => (id === shop ? { tribe, project } : null),
    requireActiveProject: () => ({ tribe, project }),
    resolveServicePlacement: () => null,
  };
  const registry = {
    getAll: () => services,
    get: (id: string) => services[id] ?? null,
    getCallableServiceIds: (id: string) => [...access].filter((edge) => edge.startsWith(`${id}->`)).map((edge) => edge.split("->")[1]),
    canAccess: (source: string, target: string) => access.has(`${source}->${target}`),
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    await pool.query("INSERT INTO apic_catalog.organizations (id, slug, name) VALUES ($1, $2, $2)", [org, `migration-${suffix}`]);
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'apic_gateway_test') THEN
        CREATE ROLE apic_gateway_test LOGIN PASSWORD 'gateway-test' NOSUPERUSER NOBYPASSRLS IN ROLE api_center_app;
      END IF;
    END $$`);
    const appUrl = new URL(url as string);
    appUrl.username = "apic_gateway_test";
    appUrl.password = "gateway-test";
    process.env.DATABASE_URL = appUrl.toString();
    process.env.CONTROL_PLANE_ALLOW_PRIVATE_UPSTREAMS = "true";
    prisma = new PrismaService();
    await prisma.onModuleInit();
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
    const access = new ApplicationAccessService(
      prisma,
      new RuntimeContextSigner({ APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k1" }) }),
      new QuotaService(prisma, audit),
    );
    admin = new ControlPlaneAdminService(prisma, audit);
    migration = new LegacyMigrationService(
      prisma,
      tenancy as never,
      registry as never,
      { listPolicies: async () => [] } as never,
      { listPlanAssignments: async () => [] } as never,
      { list: async () => [] } as never,
      audit,
    );
    bridge = new LegacyBridgeService(prisma, tenancy as never, access);
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await pool?.end();
  });

  let revision: string;
  let projectId: string;
  const legacyCaller = { sourceServiceId: api, projectId: shop, environment: "test" };
  const emailSend = { kind: "capability" as const, capability: "email", method: "POST", relativePath: "/send" };

  it("backfills a revision once, idempotently, and refuses a stale revision", async () => {
    const inventory = await migration.inventory(org);
    expect(inventory.ready).toBe(true);
    revision = inventory.revision;

    const first = await migration.backfill(org, revision, operator);
    expect(first.counts.created).toBeGreaterThan(0);
    const second = await migration.backfill(org, revision, operator);
    expect(second.counts.created).toBe(0);

    const [assignment] = await migration.assignments(org);
    expect(assignment).toMatchObject({ authority: "legacy", fenceVersion: 0, legacyProjectId: shop, legacyTribeId: tribeId });
    projectId = assignment.projectId;

    access.add(`${worker}->email`);
    await expect(migration.backfill(org, revision, operator)).rejects.toMatchObject({ code: "MIGRATION_SOURCE_CHANGED" });
    access.delete(`${worker}->email`);
  });

  it("keeps control-plane writes off a migrated environment until cutover", async () => {
    await expect(
      admin.createApplication({ organizationId: org, projectId, environmentKind: "test" }, { slug: "new-app", name: "New" }, operator),
    ).rejects.toMatchObject({ code: "LEGACY_AUTHORITY" });
  });

  it("shadows legacy decisions and blocks cutover until mismatches are resolved", async () => {
    const route = await bridge.route(legacyCaller);
    expect(route).toMatchObject({ mode: "shadow", projectId });

    await bridge.shadow(route, emailSend, true);
    expect(await migration.mismatches(org)).toEqual([]);

    // Legacy allowed a path the published API does not declare: the new model would deny it.
    await bridge.shadow(route, { kind: "service", legacyServiceId: worker, method: "DELETE", relativePath: "/admin/everything" }, true);
    const mismatches = await migration.mismatches(org);
    expect(mismatches).toEqual([expect.objectContaining({ legacyAllowed: true, newAllowed: false, target: `service:${worker}` })]);

    await expect(migration.cutover(org, projectId, "test", 0, operator)).rejects.toMatchObject({ code: "SHADOW_MISMATCHES" });
    await migration.resolveMismatches(org, projectId, "test", "Undeclared admin route is intentionally closed", operator);
    await expect(migration.cutover(org, projectId, "test", 7, operator)).rejects.toMatchObject({ code: "FENCE_MISMATCH" });
    expect(await migration.cutover(org, projectId, "test", 0, operator)).toMatchObject({ authority: "new", fenceVersion: 1 });
  });

  it("routes cut-over legacy callers through their mapped application and keeps record ownership", async () => {
    const route = await bridge.route(legacyCaller);
    expect(route.mode).toBe("control-plane");
    if (route.mode !== "control-plane") return;

    const call = await bridge.authorize(route, emailSend, { requestId: randomUUID() });
    const claims = verifyRuntimeContext(call.signedContext, { audience: "apicenter-runtime:email", keys: runtimeKeys });
    expect(claims).toMatchObject({ ownerGroupId: tribeId, ownerProjectId: shop, projectId });

    const apiCall = await bridge.authorize(route, { kind: "service", legacyServiceId: worker, method: "GET", relativePath: "/jobs/42" }, { requestId: randomUUID() });
    expect(apiCall.upstreamUrl).toBe("https://shop-worker.example.com");
    await expect(
      bridge.authorize(route, { kind: "service", legacyServiceId: worker, method: "GET", relativePath: "/admin" }, { requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "ACTION_NOT_CATALOGED" });
  });

  it("fences legacy registry writes after cutover", async () => {
    await expect(assertLegacyRegistryWritable(prisma, tenancy as never, shop, ["test"])).rejects.toMatchObject({ code: "CONTROL_PLANE_AUTHORITY" });
    await expect(assertLegacyRegistryWritable(prisma, tenancy as never, shop, ["live"])).resolves.toBeUndefined();
  });

  it("rolls back only while nothing new exists, then refuses once state was created", async () => {
    expect(await migration.rollback(org, projectId, "test", 1, operator)).toMatchObject({ authority: "legacy", fenceVersion: 2 });
    await migration.cutover(org, projectId, "test", 2, operator);

    const app = (await admin.listApplications({ organizationId: org, projectId, environmentKind: "test" })).find((entry) => entry.slug === api)!;
    await admin.issueCredential({ organizationId: org, projectId, environmentKind: "test" }, app.id, { operationId: randomUUID() }, operator);
    await expect(migration.rollback(org, projectId, "test", 3, operator)).rejects.toMatchObject({ code: "ROLLBACK_BLOCKED" });
  });
});
