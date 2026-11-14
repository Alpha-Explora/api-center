import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { OAuth2Client } from "google-auth-library";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ApplicationAccessService } from "../../../../apps/gateway/src/domains/control-plane/application-access.service";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { QuotaService } from "../../../../apps/gateway/src/domains/control-plane/quota.service";
import { WorkloadBindingService } from "../../../../apps/gateway/src/domains/control-plane/workload-binding.service";
import { isWorkloadIdentityToken, WorkloadTokenVerifier } from "../../../../apps/gateway/src/domains/control-plane/workload-identity";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-000000000501";
const AUDIENCE = "https://api.apicenter.example";
const SA = "112233445566778899001";
const actor = "admin@example.test";

function jwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", kid: "g" })}.${encode(payload)}.signature`;
}

function googleClient(payload: Record<string, unknown> | Error) {
  return {
    verifyIdToken: jest.fn(async () => {
      if (payload instanceof Error) throw payload;
      return { getPayload: () => payload };
    }),
  } as unknown as OAuth2Client;
}

beforeEach(() => {
  process.env.CONTROL_PLANE_WORKLOAD_AUDIENCES = AUDIENCE;
  process.env.DATABASE_ENABLED = "true";
});

afterEach(() => {
  delete process.env.CONTROL_PLANE_WORKLOAD_AUDIENCES;
});

describe("workload token routing and verification", () => {
  it("routes Google-issued tokens to the workload path only when workload identity is enabled", () => {
    expect(isWorkloadIdentityToken(jwt({ iss: "https://accounts.google.com", sub: SA }))).toBe(true);
    expect(isWorkloadIdentityToken(jwt({ iss: "api-center", sub: "svc" }))).toBe(false);
    expect(isWorkloadIdentityToken("ak_test_x")).toBe(false);
    delete process.env.CONTROL_PLANE_WORKLOAD_AUDIENCES;
    expect(isWorkloadIdentityToken(jwt({ iss: "https://accounts.google.com", sub: SA }))).toBe(false);
  });

  it("accepts only verified Google tokens for a configured audience", async () => {
    await expect(new WorkloadTokenVerifier(googleClient({ iss: "https://accounts.google.com", sub: SA, aud: AUDIENCE })).verify("t")).resolves.toEqual({
      issuer: "https://accounts.google.com",
      subject: SA,
      audience: AUDIENCE,
    });
    await expect(new WorkloadTokenVerifier(googleClient(new Error("bad signature"))).verify("t")).rejects.toMatchObject({ status: 401 });
    await expect(new WorkloadTokenVerifier(googleClient({ iss: "https://evil.example", sub: SA, aud: AUDIENCE })).verify("t")).rejects.toMatchObject({ status: 401 });
    await expect(new WorkloadTokenVerifier(googleClient({ iss: "accounts.google.com", sub: SA, aud: "https://other" })).verify("t")).rejects.toMatchObject({ status: 401 });
  });
});

describe("workload identity on the request path", () => {
  let prisma: FakeControlPlanePrisma;
  let admin: ControlPlaneAdminService;
  let bindings: WorkloadBindingService;
  let access: ApplicationAccessService;
  const { privateKey } = generateKeyPairSync("ed25519");

  beforeEach(() => {
    prisma = createFakeControlPlanePrisma();
    prisma.organization.rows.push({ id: ORG, status: "active" });
    const db = prisma as unknown as PrismaService;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
    admin = new ControlPlaneAdminService(db, audit);
    bindings = new WorkloadBindingService(db, audit);
    access = new ApplicationAccessService(
      db,
      new RuntimeContextSigner({ APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k" }) }),
      new QuotaService(db, audit),
      new WorkloadTokenVerifier(googleClient({ iss: "https://accounts.google.com", sub: SA, aud: AUDIENCE })),
    );
  });

  async function setup() {
    const project = await admin.createProject(ORG, { slug: "shop", name: "Shop" }, actor);
    const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
    await admin.setCapability(scope, "email", true, actor);
    const app = await admin.createApplication(scope, { slug: "worker", name: "Worker" }, actor);
    await admin.grant(scope, app.id, { capability: "email", action: "email:send" }, actor);
    return { scope, app };
  }
  const send = () =>
    access.authorize({ bearer: jwt({ iss: "https://accounts.google.com", sub: SA }), capability: "email", method: "POST", relativePath: "/send", requestId: randomUUID() });

  it("authorizes a bound workload as its application, with no stored key", async () => {
    const { scope, app } = await setup();
    await expect(send()).rejects.toMatchObject({ status: 401 });
    const binding = await bindings.bind(scope, app.id, { subject: SA, audience: AUDIENCE }, actor);
    const call = await send();
    expect(call.identity).toMatchObject({ applicationId: app.id, credentialId: `workload:${binding.id}` });

    await bindings.revoke(scope, app.id, binding.id, actor);
    await expect(send()).rejects.toMatchObject({ status: 401 });
  });

  it("binds only exact numeric subjects and configured audiences", async () => {
    const { scope, app } = await setup();
    await expect(bindings.bind(scope, app.id, { subject: "*@example.iam.gserviceaccount.com", audience: AUDIENCE }, actor)).rejects.toMatchObject({ status: 400 });
    await expect(bindings.bind(scope, app.id, { subject: SA, audience: "https://anything" }, actor)).rejects.toMatchObject({ status: 400 });
  });
});
