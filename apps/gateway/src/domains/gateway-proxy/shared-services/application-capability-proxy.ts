// Forwards a capability request made with a control-plane application credential. The caller's
// key never leaves the gateway: the runtime receives only an allowlisted set of request headers
// and the signed runtime context.

import { Injectable, Optional } from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { ApplicationAccessService } from "@domains/control-plane/application-access.service";
import { AppError } from "@shared/errors";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { assertNoEnvironmentOverrides } from "@shared/proxy/environment-leak-guard";
import { forwardSigned, relativeUpstreamPath, type CloudRunAuthorizer, type FetchLike } from "@shared/proxy/signed-forward";
import type { AuthenticatedRequest } from "../../../types";
import { SharedServiceRoutingService } from "./shared-service-routing.service";

const PATH_PREFIX = "/api/v1/shared";
const DEFAULT_TIMEOUT_MS = 30_000;

export type { CloudRunAuthorizer, FetchLike };

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
    const idempotencyKey = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : undefined;
    let call;
    try {
      call = await this.access.authorize({
        bearer,
        capability,
        method: req.method,
        relativePath,
        requestId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
    } catch (error) {
      const retryAfter = (error as { retryAfterSeconds?: unknown }).retryAfterSeconds;
      if (typeof retryAfter === "number") res.setHeader("Retry-After", String(retryAfter));
      throw error;
    }
    const route = this.routing.resolve(capability, call.identity.environmentKind);
    const status = await forwardSigned({
      req,
      res,
      targetBaseUrl: route.targetUrl,
      relativePath,
      signedContext: call.signedContext,
      requestId,
      label: `Capability '${capability}'`,
      fetchImpl: this.fetchImpl,
      cloudRunAuthorizer: this.authorizeUpstream,
      timeoutMs: this.timeoutMs,
    });
    await this.access.recordOutcome(call, status);
  }
}

/** `/api/v1/shared/email/status/abc` → `/status/abc`. Rejects traversal and encoded separators. */
export function relativeCapabilityPath(requestPath: string, capability: string): string {
  try {
    return relativeUpstreamPath(requestPath, `${PATH_PREFIX}/${capability}`);
  } catch {
    throw new AppError("Capability path is invalid", 400, "INVALID_CAPABILITY_PATH");
  }
}
