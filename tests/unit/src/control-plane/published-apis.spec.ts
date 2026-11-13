import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { Response } from "express";
import { loadRuntimeContextKeys, verifyRuntimeContext } from "@apicenter/runtime";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import type { AuthenticatedRequest } from "../../../../apps/gateway/src/types";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ApplicationAccessService } from "../../../../apps/gateway/src/domains/control-plane/application-access.service";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { QuotaService } from "../../../../apps/gateway/src/domains/control-plane/quota.service";
import { PublishedApiService } from "../../../../apps/gateway/src/domains/control-plane/published-api.service";
import { matchApiOperation, isValidPathPattern } from "../../../../apps/gateway/src/domains/control-plane/api-operations";
import { PublishedApiForwarder } from "../../../../apps/gateway/src/domains/gateway-proxy/published-apis/published-api-proxy.controller";
import { assertPublicUpstream, isPrivateAddress } from "../../../../apps/gateway/src/shared/proxy/upstream-guard";
import { createFakeControlPlanePrisma, type FakeControlPlanePrisma } from "./fake-control-plane-prisma";

const ORG = "6f1c1d1e-0000-4000-8000-000000000101";
const OTHER_ORG = "6f1c1d1e-0000-4000-8000-000000000102";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const keys = loadRuntimeContextKeys(JSON.stringify([{ ...publicKey.export({ format: "jwk" }), kid: "k" }]));

describe("upstream guard", () => {
  it.each(["10.0.0.5", "127.0.0.1", "169.254.169.254", "172.20.1.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])(
    "treats %s as private",
    (address) => expect(isPrivateAddress(address)).toBe(true),
  );

  it("accepts public addresses", () => {
    expect(isPrivateAddress("34.120.0.10")).toBe(false);
    expect(isPrivateAddress("2600:1900::1")).toBe(false);
  });

  it.each([
    ["http://api.example.com", "https"],
    ["https://user:pass@api.example.com", "credentials"],
    ["https://metadata.google.internal/computeMetadata", "not allowed"],
    ["https://localhost:8443", "not allowed"],
    ["https://10.1.2.3/orders", "publicly routable"],
  ])("rejects %s", async (url, message) => {
    await expect(assertPublicUpstream(url, { resolve: async () => ["34.120.0.10"] })).rejects.toThrow(message);
  });

  it("rejects a public name that resolves to a private address", async () => {
    await expect(assertPublicUpstream("https://rebind.example.com", { resolve: async () => ["34.120.0.10", "10.0.0.7"] })).rejects.toThrow(
      "publicly routable",
    );
    await expect(assertPublicUpstream("https://orders.example.com", { resolve: async () => ["34.120.0.10"] })).resolves.toBeInstanceOf(URL);
  });
});

describe("API operations", () => {
  const operations = [
    { method: "GET", pathPattern: "/orders/{orderId}", action: "orders:read" },
    { method: "GET", pathPattern: "/orders/summary", action: "orders:summary" },
    { method: "POST", pathPattern: "/orders", action: "orders:write" },
  ];

  it("maps requests to declared actions, preferring literal segments", () => {
    expect(matchApiOperation(operations, "get", "/orders/42")).toBe("orders:read");
    expect(matchApiOperation(operations, "GET", "/orders/summary")).toBe("orders:summary");
    expect(matchApiOperation(operations, "POST", "/orders/")).toBe("orders:write");
    expect(matchApiOperation(operations, "DELETE", "/orders/42")).toBeUndefined();
    expect(matchApiOperation(operations, "GET", "/orders/42/items")).toBeUndefined();
  });

  it("validates path patterns", () => {
    expect(isValidPathPattern("/orders/{id}")).toBe(true);
    expect(isValidPathPattern("/orders/{id}/../admin")).toBe(false);
    expect(isValidPathPattern("orders")).toBe(false);
  });
});

describe("published APIs", () => {
  let prisma: FakeControlPlanePrisma;
  let admin: ControlPlaneAdminService;
  let apis: PublishedApiService;
  let access: ApplicationAccessService;
  const actor = "publisher@example.test";

  beforeEach(() => {
    process.env.DATABASE_ENABLED = "true";
    process.env.CONTROL_PLANE_ALLOW_PRIVATE_UPSTREAMS = "true";
    prisma = createFakeControlPlanePrisma();
    prisma.organization.rows.push({ id: ORG, status: "active" }, { id: OTHER_ORG, status: "active" });
    const db = prisma as unknown as PrismaService;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
    admin = new ControlPlaneAdminService(db, audit);
    apis = new PublishedApiService(db, audit);
    access = new ApplicationAccessService(
      db,
      new RuntimeContextSigner({ APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k" }) }),
      new QuotaService(db, audit),
    );
  });

  afterEach(() => {
    delete process.env.CONTROL_PLANE_ALLOW_PRIVATE_UPSTREAMS;
  });

  async function projectWithApp(organizationId: string, slug: string) {
    const project = await admin.createProject(organizationId, { slug, name: slug }, actor);
    const scope = { organizationId, projectId: project.id, environmentKind: "test" as const };
    const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
    const { secret } = await admin.issueCredential(scope, app.id, { operationId: randomUUID() }, actor);
    return { project, scope, app, secret };
  }

  async function publishOrders() {
    const owner = await projectWithApp(ORG, "orders");
    const api = await apis.publish(
      owner.scope,
      {
        slug: "orders",
        name: "Orders",
        upstreamUrl: "http://orders.internal:8080",
        operations: [
          { method: "GET", path: "/orders/{orderId}", action: "orders:read" },
          { method: "POST", path: "/orders", action: "orders:write" },
        ],
      },
      actor,
    );
    return { owner, api };
  }

  it("grants an application in the publishing project directly and signs for the API's audience", async () => {
    const { owner, api } = await publishOrders();
    const outcome = await apis.requestAccess(owner.scope, owner.app.id, api.id, "orders:read", actor);
    expect(outcome.kind).toBe("granted");

    const call = await access.authorizeApi({ bearer: owner.secret, apiId: api.id, method: "GET", relativePath: "/orders/7", requestId: randomUUID() });
    expect(call.upstreamUrl).toBe("http://orders.internal:8080");
    const claims = verifyRuntimeContext(call.signedContext, { audience: `apicenter-api:${api.id}`, keys });
    expect(claims).toMatchObject({ action: "orders:read", applicationId: owner.app.id });
    await expect(
      access.authorizeApi({ bearer: owner.secret, apiId: api.id, method: "POST", relativePath: "/orders", requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "ACTION_NOT_GRANTED" });
    await expect(
      access.authorizeApi({ bearer: owner.secret, apiId: api.id, method: "GET", relativePath: "/admin", requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "ACTION_NOT_CATALOGED" });
  });

  it("requires the API project's approval for another project, and not from the requester", async () => {
    const { api } = await publishOrders();
    const consumer = await projectWithApp(ORG, "storefront");
    const outcome = await apis.requestAccess(consumer.scope, consumer.app.id, api.id, "orders:read", "dev@example.test");
    expect(outcome.kind).toBe("requested");
    const call = () => access.authorizeApi({ bearer: consumer.secret, apiId: api.id, method: "GET", relativePath: "/orders/1", requestId: randomUUID() });
    await expect(call()).rejects.toMatchObject({ code: "ACTION_NOT_GRANTED" });

    const requestId = outcome.kind === "requested" ? outcome.request.id : "";
    await expect(apis.decide(ORG, requestId, true, "dev@example.test")).rejects.toMatchObject({ code: "SELF_APPROVAL" });
    await apis.decide(ORG, requestId, true, actor);
    await expect(call()).resolves.toMatchObject({ action: "orders:read" });
    await expect(apis.decide(ORG, requestId, true, actor)).rejects.toMatchObject({ code: "ACCESS_REQUEST_DECIDED" });
  });

  it("never lets another organization see or call the API", async () => {
    const { api } = await publishOrders();
    const outsider = await projectWithApp(OTHER_ORG, "outsider");
    await expect(apis.requestAccess(outsider.scope, outsider.app.id, api.id, "orders:read", actor)).rejects.toMatchObject({ status: 404 });
    await expect(
      access.authorizeApi({ bearer: outsider.secret, apiId: api.id, method: "GET", relativePath: "/orders/1", requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "API_NOT_AVAILABLE" });
  });

  it("stops serving a disabled API", async () => {
    const { owner, api } = await publishOrders();
    await apis.requestAccess(owner.scope, owner.app.id, api.id, "orders:read", actor);
    await apis.update(ORG, api.id, { status: "disabled" }, actor);
    await expect(
      access.authorizeApi({ bearer: owner.secret, apiId: api.id, method: "GET", relativePath: "/orders/1", requestId: randomUUID() }),
    ).rejects.toMatchObject({ code: "API_NOT_AVAILABLE" });
  });

  it("rejects private upstreams outside local development", async () => {
    delete process.env.CONTROL_PLANE_ALLOW_PRIVATE_UPSTREAMS;
    const owner = await projectWithApp(ORG, "ssrf");
    await expect(
      apis.publish(owner.scope, { slug: "x", name: "X", upstreamUrl: "https://169.254.169.254", operations: [{ method: "GET", path: "/", action: "x:read" }] }, actor),
    ).rejects.toMatchObject({ code: "UPSTREAM_NOT_ALLOWED" });
  });

  it("forwards only the signed context to the publisher and re-checks the upstream", async () => {
    const { owner, api } = await publishOrders();
    await apis.requestAccess(owner.scope, owner.app.id, api.id, "orders:read", actor);
    const fetchImpl = jest.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    const checkUpstream = jest.fn().mockResolvedValue(undefined);
    const forwarder = new PublishedApiForwarder(access, { fetchImpl, cloudRunAuthorizer: async () => undefined, checkUpstream });
    const res = { status: jest.fn().mockReturnThis(), setHeader: jest.fn(), send: jest.fn() };
    const req = {
      method: "GET",
      path: `/api/v1/apis/${api.id}/orders/7`,
      originalUrl: `/api/v1/apis/${api.id}/orders/7`,
      query: {},
      headers: { authorization: `Bearer ${owner.secret}`, "x-tribe-id": "forged" },
    } as unknown as AuthenticatedRequest;

    await forwarder.forward(api.id, req, res as unknown as Response);

    expect(checkUpstream).toHaveBeenCalledWith("http://orders.internal:8080");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://orders.internal:8080/orders/7");
    expect(Object.keys(init.headers)).toEqual(["X-APICenter-Context", "X-APICenter-Correlation-Id", "X-Correlation-ID", "X-Forwarded-By"]);
    expect(JSON.stringify(init)).not.toContain(owner.secret);

    await expect(
      forwarder.forward(api.id, { ...req, headers: { authorization: "Bearer legacy.jwt.token" } } as unknown as AuthenticatedRequest, res as unknown as Response),
    ).rejects.toMatchObject({ status: 401 });
  });
});
