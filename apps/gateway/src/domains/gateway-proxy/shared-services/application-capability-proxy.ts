// Forwards a capability request made with a control-plane application credential. The caller's
// key never leaves the gateway: the runtime receives only an allowlisted set of request headers
// and the signed runtime context.

import { Injectable, Optional } from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { ApplicationAccessService } from "@domains/control-plane/application-access.service";
import { RUNTIME_CONTEXT_HEADER } from "@domains/control-plane/control-plane.types";
import { AppError, BadGatewayError } from "@shared/errors";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { assertNoEnvironmentOverrides } from "@shared/proxy/environment-leak-guard";
import type { AuthenticatedRequest } from "../../../types";
import { SharedServiceRoutingService } from "./shared-service-routing.service";

const PATH_PREFIX = "/api/v1/shared";
const FORWARDED_REQUEST_HEADERS = ["idempotency-key", "accept"];
const RETURNED_RESPONSE_HEADERS = ["content-type", "x-idempotency-replayed", "retry-after"];
const DEFAULT_TIMEOUT_MS = 30_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<globalThis.Response>;
export type CloudRunAuthorizer = (upstream: string) => Promise<string | undefined>;

@Injectable()
export class ApplicationCapabilityProxy {
  private readonly fetchImpl: FetchLike;
  private readonly authorizeUpstream: CloudRunAuthorizer;
  private readonly timeoutMs: number;

  constructor(
    private readonly access: ApplicationAccessService,
    private readonly routing: SharedServiceRoutingService,
    @Optional() options?: { fetchImpl?: FetchLike; cloudRunAuthorizer?: CloudRunAuthorizer; timeoutMs?: number },
  ) {
    this.fetchImpl = options?.fetchImpl ?? ((url, init) => fetch(url, init));
    this.authorizeUpstream = options?.cloudRunAuthorizer ?? getCloudRunAuthorizationHeader;
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.PROXY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  }

  async forward(capability: string, bearer: string, req: AuthenticatedRequest, res: Response): Promise<void> {
    assertNoEnvironmentOverrides({
      headers: req.headers as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      body: req.body,
    });

    const relativePath = relativeCapabilityPath(req.path, capability);
    const requestId = req.correlationId || randomUUID();
    const call = await this.access.authorize({
      bearer,
      capability,
      method: req.method,
      relativePath,
      requestId,
    });
    const route = this.routing.resolve(capability, call.identity.environmentKind);

    const headers: Record<string, string> = {
      [RUNTIME_CONTEXT_HEADER]: call.signedContext,
      "X-APICenter-Correlation-Id": requestId,
      "X-Correlation-ID": requestId,
      "X-Forwarded-By": "apicenter-gateway",
    };
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = req.headers[name];
      if (typeof value === "string" && value) headers[name] = value;
    }
    const cloudRunAuthorization = await this.authorizeUpstream(route.targetUrl);
    if (cloudRunAuthorization) {
      headers.Authorization = cloudRunAuthorization;
      headers["X-Serverless-Authorization"] = cloudRunAuthorization;
    }

    const hasBody = !["GET", "HEAD"].includes(req.method.toUpperCase()) && req.body !== undefined;
    if (hasBody) headers["Content-Type"] = "application/json";

    const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
    const target = `${route.targetUrl.replace(/\/$/, "")}${relativePath}${query}`;

    let upstream: globalThis.Response;
    try {
      upstream = await this.fetchImpl(target, {
        method: req.method,
        headers,
        ...(hasBody ? { body: JSON.stringify(req.body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "manual",
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new AppError(`Capability '${capability}' did not respond in time`, 504, "UPSTREAM_TIMEOUT");
      }
      throw new BadGatewayError(`Capability '${capability}' is unreachable`);
    }

    res.status(upstream.status);
    for (const name of RETURNED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader("X-Correlation-ID", requestId);
    res.send(Buffer.from(await upstream.arrayBuffer()));
  }
}

/** `/api/v1/shared/email/status/abc` → `/status/abc`. Rejects traversal and encoded separators. */
export function relativeCapabilityPath(requestPath: string, capability: string): string {
  const prefix = `${PATH_PREFIX}/${capability}`;
  if (!requestPath.startsWith(`${prefix}/`)) {
    throw new AppError("Capability path is invalid", 400, "INVALID_CAPABILITY_PATH");
  }
  const relative = requestPath.slice(prefix.length);
  const segments = relative.split("/").slice(1);
  if (segments.some((segment) => segment === "." || segment === ".." || /%2f|%5c|%2e/i.test(segment))) {
    throw new AppError("Capability path is invalid", 400, "INVALID_CAPABILITY_PATH");
  }
  return relative;
}
