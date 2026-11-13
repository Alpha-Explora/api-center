// Runs the control plane against a real, migrated PostgreSQL database.
// Opt-in: APICENTER_CONTROL_PLANE_TEST_URL must name a disposable local database that already
// has every supabase/migrations file applied (scripts/replay-supabase-migrations.cjs).
//   APICENTER_CONTROL_PLANE_TEST_URL=postgres://postgres:postgres@localhost:55439/replay \
//     npx jest --config tests/integration/jest-integration.json control-plane.database

import { generateKeyPairSync, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { loadRuntimeContextKeys, verifyRuntimeContext } from "@apicenter/runtime";
import { PrismaService } from "../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ControlPlaneAdminService } from "../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ApplicationAccessService } from "../../apps/gateway/src/domains/control-plane/application-access.service";
import { RuntimeContextSigner } from "../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { QuotaService } from "../../apps/gateway/src/domains/control-plane/quota.service";
import { LiveEnvironmentService } from "../../apps/gateway/src/domains/control-plane/live-environment.service";
import { ApprovalRequestService } from "../../apps/gateway/src/domains/governance/approvals/approval-request.service";

const url = process.env.APICENTER_CONTROL_PLANE_TEST_URL;
if (url && !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error("Refusing a non-local control plane test database");
}
const describeWithDatabase = url ? describe : describe.skip;

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const runtimeKeys = loadRuntimeContextKeys(JSON.stringify([{ ...publicKey.export({ format: "jwk" }), kid: "k1" }]));
const actor = "integration@example.test";

describeWithDatabase("control plane on PostgreSQL", () => {
  let pool: Pool;
  let prisma: PrismaService;
  let admin: ControlPlaneAdminService;
  let access: ApplicationAccessService;
  let quotas: QuotaService;
  let live: LiveEnvironmentService;
  const orgA = randomUUID();
  const orgB = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 });
    // The gateway connects as a login role inside api_center_app without BYPASSRLS, as in
    // production, so row-level security applies to everything the services below do.
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'apic_gateway_test') THEN
        CREATE ROLE apic_gateway_test LOGIN PASSWORD 'gateway-test' NOSUPERUSER NOBYPASSRLS IN ROLE api_center_app;
      END IF;
    END $$`);
    const appUrl = new URL(url as string);
    appUrl.username = "apic_gateway_test";
    appUrl.password = "gateway-test";
    process.env.DATABASE_URL = appUrl.toString();
    for (const [id, slug] of [[orgA, `cp-a-${orgA.slice(0, 8)}`], [orgB, `cp-b-${orgB.slice(0, 8)}`]]) {
      await pool.query("INSERT INTO apic_catalog.organizations (id, slug, name) VALUES ($1, $2, $2)", [id, slug]);
    }
    prisma = new PrismaService();
    await prisma.onModuleInit();
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
    admin = new ControlPlaneAdminService(prisma, audit);
    quotas = new QuotaService(prisma, audit);
    live = new LiveEnvironmentService(prisma, new ApprovalRequestService(prisma), audit);
    access = new ApplicationAccessService(
      prisma,
      new RuntimeContextSigner({
        APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k1" }),
      }),
      quotas,
    );
  });

  afterAll(async () => {
    await prisma?.onModuleDestroy();
    await pool?.end();
  });

  it("runs the test onboarding journey and authorizes only the granted action", async () => {
    const project = await admin.createProject(orgA, { slug: "serbizio", name: "Serbizio" }, actor);
    const scope = { organizationId: orgA, projectId: project.id, environmentKind: "test" as const };
    await admin.setCapability(scope, "email", true, actor);
    const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
    await admin.grant(scope, app.id, { capability: "email", action: "email:send" }, actor);
    const operationId = randomUUID();
    const credential = await admin.issueCredential(scope, app.id, { operationId }, actor);

    const call = await access.authorize({
      bearer: credential.secret,
      capability: "email",
      method: "POST",
      relativePath: "/send",
      requestId: randomUUID(),
    });
    expect(verifyRuntimeContext(call.signedContext, { audience: "apicenter-runtime:email", keys: runtimeKeys })).toMatchObject({
      organizationId: orgA,
      projectId: project.id,
      applicationId: app.id,
    });
    await expect(
      access.authorize({ bearer: credential.secret, capability: "email", method: "GET", relativePath: "/status/m1", requestId: "r" }),
    ).rejects.toMatchObject({ code: "ACTION_NOT_GRANTED" });

    await expect(admin.issueCredential(scope, app.id, { operationId }, actor)).rejects.toMatchObject({ code: "CREDENTIAL_ALREADY_ISSUED" });
    const stored = await pool.query("SELECT verifier_sha256, lookup_prefix FROM apic_catalog.cp_credentials WHERE application_id = $1", [app.id]);
    expect(stored.rows).toHaveLength(1);
    expect(JSON.stringify(stored.rows)).not.toContain(credential.secret);
  });

  it("serializes concurrent retries of one issuance operation into a single credential", async () => {
    const project = await admin.createProject(orgA, { slug: "concurrency", name: "Concurrency" }, actor);
    const scope = { organizationId: orgA, projectId: project.id, environmentKind: "test" as const };
    const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
    const operationId = randomUUID();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => admin.issueCredential(scope, app.id, { operationId }, actor)),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const count = await pool.query("SELECT count(*)::int AS n FROM apic_catalog.cp_credentials WHERE application_id = $1", [app.id]);
    expect(count.rows[0].n).toBe(1);
  });

  describe("live activation", () => {
    async function approval(targetId: string, status = "approved") {
      const result = await pool.query(
        `INSERT INTO apic_governance.approval_requests (action_type, target_id, target_environment, status, before, after, risk_level, reason, requested_by, approved_by, approved_at)
         VALUES ('environment.activate_live', $1, 'live', $2, '{}', '{}', 'high', 'go live', 'dev@example.test', 'owner@example.test', now()) RETURNING id`,
        [targetId, status],
      );
      return result.rows[0].id as string;
    }

    async function readyLiveProject(slug: string) {
      const project = await admin.createProject(orgA, { slug, name: slug }, actor);
      await live.provision(orgA, project.id, actor);
      const scope = { organizationId: orgA, projectId: project.id, environmentKind: "live" as const };
      await quotas.assignPlan(scope, "standard", actor);
      await admin.setCapability(scope, "email", true, actor);
      const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
      await admin.grant(scope, app.id, { capability: "email", action: "email:send" }, actor);
      return { project, scope, app };
    }

    it("consumes one approval for exactly one project, then issues live credentials", async () => {
      const first = await readyLiveProject("live-first");
      const second = await readyLiveProject("live-second");
      const approvalId = await approval(first.project.id);

      await expect(live.activate(orgA, second.project.id, approvalId, actor)).rejects.toThrow("target does not match");
      await live.activate(orgA, first.project.id, approvalId, actor);
      const status = await pool.query("SELECT status FROM apic_governance.approval_requests WHERE id = $1", [approvalId]);
      expect(status.rows[0].status).toBe("applied");

      const { secret } = await admin.issueCredential(first.scope, first.app.id, { operationId: randomUUID() }, actor);
      const call = await access.authorize({ bearer: secret, capability: "email", method: "POST", relativePath: "/send", requestId: randomUUID() });
      expect(call.identity.environmentKind).toBe("live");
    });

    it("leaves the environment provisioning when activation fails after readiness", async () => {
      const { project } = await readyLiveProject("live-pending");
      const pending = await approval(project.id, "pending");
      await expect(live.activate(orgA, project.id, pending, actor)).rejects.toThrow("not approved");
      expect((await live.readiness(orgA, project.id)).status).toBe("provisioning");
    });

    it("cannot be marked active in the database without an approval", async () => {
      const { project } = await readyLiveProject("live-direct");
      await expect(
        pool.query("UPDATE apic_catalog.cp_environments SET status = 'active' WHERE project_id = $1 AND kind = 'live'", [project.id]),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });

  describe("request budgets", () => {
    async function onboardApp(slug: string) {
      const project = await admin.createProject(orgA, { slug, name: slug }, actor);
      const scope = { organizationId: orgA, projectId: project.id, environmentKind: "test" as const };
      await admin.setCapability(scope, "email", true, actor);
      const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
      await admin.grant(scope, app.id, { capability: "email", action: "email:send" }, actor);
      const { secret } = await admin.issueCredential(scope, app.id, { operationId: randomUUID() }, actor);
      const send = () =>
        access.authorize({ bearer: secret, capability: "email", method: "POST", relativePath: "/send", requestId: randomUUID() });
      return { project, scope, app, send };
    }

    it("admits exactly the limit under concurrency", async () => {
      const { project, send } = await onboardApp("budget-concurrency");
      await quotas.createProjectPolicy(orgA, project.id, { environmentKind: "test", windowSeconds: 3600, maxRequests: 3, mode: "enforce" }, actor);
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => send()));
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      expect(rejected.every((result) => (result.reason as { code?: string }).code === "QUOTA_EXCEEDED")).toBe(true);
    });

    it("charges no budget for a request another budget rejects", async () => {
      const { project, send } = await onboardApp("budget-rollback");
      await quotas.createSharedPolicy(orgA, [project.id], { environmentKind: "test", windowSeconds: 3600, maxRequests: 1, mode: "enforce" }, actor);
      await send();
      await expect(send()).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
      await expect(send()).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
      const counters = await pool.query(
        "SELECT budget_key, request_count FROM apic_catalog.cp_quota_counters WHERE budget_key LIKE $1 ORDER BY budget_key",
        ["test-default:%"],
      );
      const usage = await pool.query("SELECT count(*)::int AS n FROM apic_catalog.cp_usage_records WHERE project_id = $1", [project.id]);
      expect(usage.rows[0].n).toBe(1);
      const environmentId = (await admin.getProject(orgA, project.id)).environments[0].id;
      expect(counters.rows.find((row) => row.budget_key === `test-default:${environmentId}`)?.request_count).toBe(1);
    });
  });

  describe("row-level tenant isolation for the application role", () => {
    let appPool: Pool;
    beforeAll(() => {
      appPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    });
    afterAll(async () => {
      await appPool.end();
    });

    async function asTenant<T>(organizationId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
      const client = await appPool.connect();
      try {
        await client.query("BEGIN");
        if (organizationId) await client.query("SELECT set_config('apicenter.organization_id', $1, true)", [organizationId]);
        const result = await client.query(sql, params);
        await client.query("COMMIT");
        return result.rows as T[];
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }

    it("shows no control-plane rows without a tenant and only the tenant's rows with one", async () => {
      await admin.createProject(orgB, { slug: "other-tenant", name: "Other" }, actor);
      expect(await asTenant(null, "SELECT id FROM apic_catalog.cp_projects")).toEqual([]);
      const visibleToA = await asTenant<{ organization_id: string }>(orgA, "SELECT organization_id FROM apic_catalog.cp_projects");
      expect(visibleToA.length).toBeGreaterThan(0);
      expect(new Set(visibleToA.map((row) => row.organization_id))).toEqual(new Set([orgA]));
    });

    it("rejects writing a row into another organization", async () => {
      await expect(
        asTenant(orgA, "INSERT INTO apic_catalog.cp_projects (id, organization_id, slug, name, created_by) VALUES ($1, $2, 'smuggled', 'x', 'x')", [
          `prj_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
          orgB,
        ]),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("discloses only the organization of an exact credential prefix before a tenant is set", async () => {
      const rows = await asTenant<{ org: string | null }>(null, "SELECT apic_catalog.cp_credential_organization('ak_test_doesnotexist0000') AS org");
      expect(rows).toEqual([{ org: null }]);
      await expect(asTenant(null, "SELECT lookup_prefix FROM apic_catalog.cp_credentials")).resolves.toEqual([]);
    });
  });

  describe("ownership constraints", () => {
    let projectA: string;
    let environmentA: string;
    let applicationA: string;

    beforeAll(async () => {
      const project = await admin.createProject(orgA, { slug: "constraints", name: "Constraints" }, actor);
      projectA = project.id;
      environmentA = project.environments[0].id;
      applicationA = (await admin.createApplication(
        { organizationId: orgA, projectId: projectA, environmentKind: "test" },
        { slug: "api", name: "API" },
        actor,
      )).id;
    });

    const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;

    it("rejects an environment whose organization differs from its project's", async () => {
      await expect(
        pool.query("INSERT INTO apic_catalog.cp_environments (id, organization_id, project_id, kind, status) VALUES ($1, $2, $3, 'live', 'provisioning')", [
          id("env"),
          orgB,
          projectA,
        ]),
      ).rejects.toMatchObject({ code: "23503" });
    });

    it("rejects an application placed in another organization's environment", async () => {
      await expect(
        pool.query(
          "INSERT INTO apic_catalog.cp_applications (id, organization_id, project_id, environment_id, slug, name, created_by) VALUES ($1, $2, $3, $4, 'x', 'x', 'test')",
          [id("app"), orgB, projectA, environmentA],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });

    it("rejects a credential whose prefix and environment kind disagree", async () => {
      await expect(
        pool.query(
          `INSERT INTO apic_catalog.cp_credentials (id, organization_id, project_id, environment_id, application_id, environment_kind,
             lookup_prefix, verifier_sha256, expires_at, created_by)
           VALUES ($1, $2, $3, $4, $5, 'test', 'ak_live_abcdefghijklmnop', $6, now() + interval '1 day', 'test')`,
          [id("crd"), orgA, projectA, environmentA, applicationA, "a".repeat(64)],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("rejects a grant for an application in another environment's tuple", async () => {
      await expect(
        pool.query(
          `INSERT INTO apic_catalog.cp_application_grants (id, organization_id, project_id, environment_id, application_id,
             target_kind, target_id, action, created_by) VALUES ($1, $2, $3, $4, $5, 'capability', 'email', 'email:send', 'test')`,
          [id("grt"), orgB, projectA, environmentA, applicationA],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });

    it("allows team membership and project roles only for organization members", async () => {
      const team = `tm_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
      await pool.query("INSERT INTO apic_catalog.cp_teams (id, organization_id, slug, name, created_by) VALUES ($1, $2, $3, 'T', 'test')", [
        team,
        orgA,
        `team-${team.slice(3, 11)}`,
      ]);
      await expect(
        pool.query("INSERT INTO apic_catalog.cp_team_members (organization_id, team_id, email, created_by) VALUES ($1, $2, 'stranger@example.test', 'test')", [orgA, team]),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        pool.query(
          "INSERT INTO apic_catalog.cp_project_role_assignments (id, organization_id, project_id, member_email, team_id, role, created_by) VALUES ($1, $2, $3, NULL, NULL, 'viewer', 'test')",
          [id("pra"), orgA, projectA],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        pool.query(
          "INSERT INTO apic_catalog.cp_project_role_assignments (id, organization_id, project_id, team_id, role, created_by) VALUES ($1, $2, $3, $4, 'viewer', 'test')",
          [id("pra"), orgB, projectA, team],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    });

    it("accepts the new organization roles alongside legacy ones", async () => {
      await pool.query("INSERT INTO apic_catalog.organization_members (organization_id, email, role) VALUES ($1, 'owner@example.test', 'owner')", [orgA]);
      await expect(
        pool.query("INSERT INTO apic_catalog.organization_members (organization_id, email, role) VALUES ($1, 'x@example.test', 'superuser')", [orgA]),
      ).rejects.toMatchObject({ code: "23514" });
    });

    it("keeps environment kind immutable", async () => {
      await expect(pool.query("UPDATE apic_catalog.cp_environments SET kind = 'live' WHERE id = $1", [environmentA])).rejects.toThrow(
        "immutable",
      );
    });
  });
});
