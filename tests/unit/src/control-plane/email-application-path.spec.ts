// End to end inside one process: control plane admin → application credential → gateway proxy
// (real fetch) → the real email runtime app, which verifies the signed runtime context.

import path from "node:path";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { Response } from "express";
import type { PrismaService } from "../../../../apps/gateway/src/database/prisma.service";
import type { AuditEventsService } from "../../../../apps/gateway/src/domains/compliance/audit/audit-events.service";
import type { AuthenticatedRequest } from "../../../../apps/gateway/src/types";
import { ControlPlaneAdminService } from "../../../../apps/gateway/src/domains/control-plane/control-plane-admin.service";
import { ApplicationAccessService } from "../../../../apps/gateway/src/domains/control-plane/application-access.service";
import { RuntimeContextSigner } from "../../../../apps/gateway/src/domains/control-plane/runtime-context.signer";
import { QuotaService } from "../../../../apps/gateway/src/domains/control-plane/quota.service";
import { ApplicationCapabilityProxy } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/application-capability-proxy";
import { SharedServiceRoutingService } from "../../../../apps/gateway/src/domains/gateway-proxy/shared-services/shared-service-routing.service";
import { createFakeControlPlanePrisma } from "./fake-control-plane-prisma";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.NODE_ENV = "development";
delete process.env.DATABASE_URL;
process.env.APICENTER_RUNTIME_CONTEXT_PUBLIC_KEYS = JSON.stringify([{ ...publicKey.export({ format: "jwk" }), kid: "k1" }]);

const ORG = "6f1c1d1e-0000-4000-8000-0000000000aa";
const actor = "admin@example.test";

let server: { address(): { port: number }; close(callback: () => void): void };
let baseUrl: string;

beforeAll(async () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { app } = require(path.resolve(__dirname, "../../../../apps/email/src/server.ts")) as {
    app: { listen: (port: number, callback: () => void) => typeof server };
  };
  server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 180000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function gateway() {
  process.env.DATABASE_ENABLED = "true";
  const prisma = createFakeControlPlanePrisma();
  prisma.organization.rows.push({ id: ORG, status: "active" });
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditEventsService;
  const admin = new ControlPlaneAdminService(prisma as unknown as PrismaService, audit);
  const signer = new RuntimeContextSigner({
    APICENTER_RUNTIME_CONTEXT_SIGNING_KEY: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "k1" }),
  });
  const proxy = new ApplicationCapabilityProxy(
    new ApplicationAccessService(prisma as unknown as PrismaService, signer, new QuotaService(prisma as unknown as PrismaService, audit)),
    new SharedServiceRoutingService({ SHARED_SERVICE_ROUTE_EMAIL_TEST: baseUrl }),
    { cloudRunAuthorizer: async () => undefined },
  );
  return { admin, proxy, signer };
}

function capture() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
    },
    send(buffer: Buffer) {
      res.body = JSON.parse(buffer.toString("utf8"));
    },
  };
  return res;
}

function gatewayRequest(method: string, relative: string, bearer: string, body?: unknown, idempotencyKey?: string) {
  const fullPath = `/api/v1/shared/email${relative}`;
  return {
    method,
    path: fullPath,
    originalUrl: fullPath,
    query: {},
    body,
    correlationId: randomUUID(),
    headers: {
      authorization: `Bearer ${bearer}`,
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      // Forged legacy identity: must never reach or influence the runtime.
      "x-tribe-id": "victim-tribe",
      "x-apicenter-project-id": "victim-project",
    },
  } as unknown as AuthenticatedRequest;
}

it("sends and reads an email with an application credential and no registered service", async () => {
  const { admin, proxy } = gateway();
  const project = await admin.createProject(ORG, { slug: "serbizio", name: "Serbizio" }, actor);
  const scope = { organizationId: ORG, projectId: project.id, environmentKind: "test" as const };
  await admin.setCapability(scope, "email", true, actor);
  const app = await admin.createApplication(scope, { slug: "api", name: "API" }, actor);
  await admin.grant(scope, app.id, { capability: "email", action: "email:send" }, actor);
  await admin.grant(scope, app.id, { capability: "email", action: "email:read" }, actor);
  const { secret } = await admin.issueCredential(scope, app.id, { operationId: randomUUID() }, actor);

  const sent = capture();
  const input = { to: "user@example.test", subject: "Hello", text: "World" };
  await proxy.forward("email", secret, gatewayRequest("POST", "/send", secret, input, "app-path-idem-key-0001"), sent as unknown as Response);
  expect(sent.statusCode).toBe(201);
  const messageId = (sent.body as { data: { messageId: string } }).data.messageId;

  const replay = capture();
  await proxy.forward("email", secret, gatewayRequest("POST", "/send", secret, input, "app-path-idem-key-0001"), replay as unknown as Response);
  expect(replay.headers["x-idempotency-replayed"]).toBe("true");
  expect((replay.body as { data: { messageId: string } }).data.messageId).toBe(messageId);

  const status = capture();
  await proxy.forward("email", secret, gatewayRequest("GET", `/status/${encodeURIComponent(messageId)}`, secret), status as unknown as Response);
  expect(status.statusCode).toBe(200);

  // A legacy caller presenting the victim's forged identity headers cannot see the message.
  const legacy = await fetch(`${baseUrl}/status/${encodeURIComponent(messageId)}`, {
    headers: {
      "X-Tribe-Id": "victim-tribe",
      "X-APICenter-Project-Id": "victim-project",
      "X-APICenter-Source-Service-Id": "victim-service",
      "X-APICenter-Environment": "test",
    },
  });
  expect(legacy.status).toBe(404);
}, 60000);

it("rejects a request whose signed context was tampered with", async () => {
  const { signer } = gateway();
  const token = signer.sign({
    identity: {
      organizationId: ORG,
      projectId: "prj_aaaaaaaaaaaaaaaaaaaaaaaa",
      environmentId: "env_aaaaaaaaaaaaaaaaaaaaaaaa",
      environmentKind: "test",
      applicationId: "app_aaaaaaaaaaaaaaaaaaaaaaaa",
      credentialId: "crd_aaaaaaaaaaaaaaaaaaaaaaaa",
    },
    capability: "email",
    action: "email:send",
    requestId: "r1",
  });
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const forged = Buffer.from(JSON.stringify({ ...claims, prj: "prj_bbbbbbbbbbbbbbbbbbbbbbbb" })).toString("base64url");

  const response = await fetch(`${baseUrl}/send`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "tampered-context-key-0001", "X-APICenter-Context": `${header}.${forged}.${signature}` },
    body: JSON.stringify({ to: "user@example.test", subject: "Hi", text: "x" }),
  });
  expect(response.status).toBe(403);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe("CALLER_CONTEXT_REQUIRED");
});

it("rejects a context signed for a different runtime", async () => {
  const { signer } = gateway();
  const token = signer.sign({
    identity: {
      organizationId: ORG,
      projectId: "prj_aaaaaaaaaaaaaaaaaaaaaaaa",
      environmentId: "env_aaaaaaaaaaaaaaaaaaaaaaaa",
      environmentKind: "test",
      applicationId: "app_aaaaaaaaaaaaaaaaaaaaaaaa",
      credentialId: "crd_aaaaaaaaaaaaaaaaaaaaaaaa",
    },
    capability: "sms",
    action: "sms:send",
    requestId: "r2",
  });
  const response = await fetch(`${baseUrl}/send`, {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": "wrong-audience-key-0001", "X-APICenter-Context": token },
    body: JSON.stringify({ to: "user@example.test", subject: "Hi", text: "x" }),
  });
  expect(response.status).toBe(403);
});
