// /api/v1/apis/:apiId/* — calls to APIs that projects publish through the control plane.
// Only application credentials are accepted. The publisher receives the signed context
// (audience apicenter-api:<apiId>) and never the caller's key. The upstream is re-checked
// against private and metadata addresses on every request.

import { All, Controller, Injectable, Optional, Param, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { ApplicationAccessService } from "@domains/control-plane/application-access.service";
import { isApplicationCredential } from "@domains/control-plane/control-plane.types";
import { UnauthorizedError } from "@shared/errors";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { assertNoEnvironmentOverrides } from "@shared/proxy/environment-leak-guard";
import { forwardSigned, relativeUpstreamPath, type CloudRunAuthorizer, type FetchLike } from "@shared/proxy/signed-forward";
import { assertPublicUpstream, upstreamGuardOptions } from "@shared/proxy/upstream-guard";
import type { AuthenticatedRequest } from "../../../types";

const DEFAULT_TIMEOUT_MS = 30_000;

@Injectable()
export class PublishedApiForwarder {
  private readonly fetchImpl: FetchLike;
  private readonly authorizeUpstream: CloudRunAuthorizer;
  private readonly timeoutMs: number;
  private readonly checkUpstream: (url: string) => Promise<unknown>;

  constructor(
    private readonly access: ApplicationAccessService,
    @Optional()
    options?: { fetchImpl?: FetchLike; cloudRunAuthorizer?: CloudRunAuthorizer; timeoutMs?: number; checkUpstream?: (url: string) => Promise<unknown> },
  ) {
    this.fetchImpl = options?.fetchImpl ?? ((url, init) => fetch(url, init));
    this.authorizeUpstream = options?.cloudRunAuthorizer ?? getCloudRunAuthorizationHeader;
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.PROXY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    this.checkUpstream = options?.checkUpstream ?? ((url) => assertPublicUpstream(url, upstreamGuardOptions()));
  }

  async forward(apiId: string, req: AuthenticatedRequest, res: Response): Promise<void> {
    const authorization = req.headers.authorization;
    const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
    if (!bearer || !isApplicationCredential(bearer)) {
      throw new UnauthorizedError("Published APIs accept application credentials only");
    }
    assertNoEnvironmentOverrides({
      headers: req.headers as Record<string, unknown>,
      query: req.query as Record<string, unknown>,
      body: req.body,
    });
    const relativePath = relativeUpstreamPath(req.path, `/api/v1/apis/${apiId}`);
    const requestId = req.correlationId || randomUUID();
    const idempotencyKey = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : undefined;
    let call;
    try {
      call = await this.access.authorizeApi({
        bearer,
        apiId,
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
    await this.checkUpstream(call.upstreamUrl);
    const status = await forwardSigned({
      req,
      res,
      targetBaseUrl: call.upstreamUrl,
      relativePath,
      signedContext: call.signedContext,
      requestId,
      label: `API '${apiId}'`,
      fetchImpl: this.fetchImpl,
      cloudRunAuthorizer: this.authorizeUpstream,
      timeoutMs: this.timeoutMs,
    });
    await this.access.recordOutcome(call, status);
  }
}

@Controller("apis")
export class PublishedApiProxyController {
  constructor(private readonly forwarder: PublishedApiForwarder) {}

  @All(":apiId/*path")
  async proxy(@Param("apiId") apiId: string, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    await this.forwarder.forward(apiId, req, res);
  }
}
