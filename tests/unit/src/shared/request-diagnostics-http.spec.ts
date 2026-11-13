import express from "express";
import type { Server } from "node:http";
import { Test } from "@nestjs/testing";
import { RequestDiagnosticsMiddleware } from "@shared/middleware/request-diagnostics.middleware";
import {
  RequestDiagnosticsStore,
  type DiagnosticRecord,
} from "@shared/request-diagnostics.store";
import { LoggerService } from "@shared/logger.service";
import type { AuthenticatedRequest } from "../../../../apps/gateway/src/types";

describe("request diagnostic HTTP boundary", () => {
  let server: Server;
  let base: string;
  const records: DiagnosticRecord[] = [];
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        RequestDiagnosticsMiddleware,
        {
          provide: RequestDiagnosticsStore,
          useValue: {
            record: async (value: DiagnosticRecord) => {
              records.push(value);
            },
          },
        },
        { provide: LoggerService, useValue: { warn: jest.fn() } },
      ],
    }).compile();
    const middleware = module.get(RequestDiagnosticsMiddleware);
    const app = express();
    app.use(express.json());
    app.use((req, res, next) =>
      middleware.use(req as AuthenticatedRequest, res, next),
    );
    app.post("/denied/:id", (_req, res) => {
      res.locals.requestDiagnostic = { code: "UNAUTHORIZED" };
      res.status(401).json({ error: "Denied" });
    });
    app.post("/token", (req, res) => {
      const authenticated = req as AuthenticatedRequest;
      authenticated.sourceServiceId = "consumer-a";
      authenticated.projectId = "project-a";
      authenticated.diagnosticEnvironment = "test";
      res.locals.paymentResourceId = "chk_fixture";
      res.status(201).json({ accessToken: "secret-response-token" });
    });
    server = await new Promise<Server>((resolve) => {
      const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected loopback TCP server");
    base = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("records final denied status and route template without untrusted identity or sensitive data", async () => {
    const response = await fetch(
      base + "/denied/private-recipient?secret=private-query",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-correlation-id": "fixture-correlation",
          authorization: "Bearer private-bearer",
        },
        body: JSON.stringify({
          secret: "private-body",
          serviceId: "forged-service",
          environment: "live",
        }),
      },
    );
    expect(response.status).toBe(401);
    const record = records.find(
      (row) => row.requestId === response.headers.get("x-request-id"),
    );
    expect(record).toMatchObject({
      correlationId: "fixture-correlation",
      serviceId: null,
      projectId: null,
      environment: null,
      route: "/denied/:id",
      statusCode: 401,
      failureStage: "authentication",
    });
    expect(JSON.stringify(record)).not.toMatch(/private-|forged-service/);
  });

  it("records trusted token placement and returns a safe generated correlation ID", async () => {
    const response = await fetch(base + "/token", {
      method: "POST",
      headers: { "x-correlation-id": "invalid correlation" },
    });
    expect(response.status).toBe(201);
    const record = records.find(
      (row) => row.requestId === response.headers.get("x-request-id"),
    );
    expect(record).toMatchObject({
      serviceId: "consumer-a",
      projectId: "project-a",
      environment: "test",
      statusCode: 201,
      failureStage: null,
      paymentResourceId: "chk_fixture",
    });
    expect(record?.correlationId).toBe(response.headers.get("x-request-id"));
    expect(JSON.stringify(record)).not.toContain("secret-response-token");
  });
});
