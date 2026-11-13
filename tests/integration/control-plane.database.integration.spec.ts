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
  const orgA = randomUUID();
  const orgB = randomUUID();

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    pool = new Pool({ connectionString: url, max: 2 });
    for (const [id, slug] of [[orgA, `cp-a-${orgA.slice(0, 8)}`], [orgB, `cp-b-${orgB.slice(0, 8)}`]]) {
      await pool.query("INSERT INTO apic_catalog.organizations (id, slug, name) VALUES ($1, $2, $2)", [id, slug]);
    }
    prisma = new PrismaService();
    await prisma.onModuleInit();
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
    admin = new ControlPlaneAdminService(prisma, audit);
    access = new ApplicationAccessService(
      prisma,
      new RuntimeContextSigner({
        APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k1" }),
      }),
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
        pool.query("INSERT INTO apic_catalog.cp_environments (id, organization_id, project_id, kind) VALUES ($1, $2, $3, 'live')", [
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
