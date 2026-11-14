// Routes a legacy service-JWT call through the migration bridge.
// - Not migrated: the legacy handler runs unchanged.
// - Migrated, legacy authority: the legacy handler decides; the control-plane decision is shadowed.
// - Migrated and cut over: the mapped application's grants decide, and the call is forwarded with
//   the signed context exactly like an application credential call.

import { Injectable, Optional } from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { LegacyBridgeService, type LegacyTarget } from "@domains/control-plane/migration/legacy-bridge.service";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { resolveSharedServiceRoute } from "@shared/proxy/shared-service-route";
import { forwardSigned, type CloudRunAuthorizer, type FetchLike } from "@shared/proxy/signed-forward";
import { assertPublicUpstream, upstreamGuardOptions } from "@shared/proxy/upstream-guard";
import type { AuthenticatedRequest } from "../../../types";

const DEFAULT_TIMEOUT_MS = 30_000;

@Injectable()
export class LegacyCallerDispatcher {
  private readonly fetchImpl: FetchLike;
  private readonly authorizeUpstream: CloudRunAuthorizer;
  private readonly timeoutMs: number;

  constructor(
    private readonly bridge: LegacyBridgeService,
    @Optional() options?: { fetchImpl?: FetchLike; cloudRunAuthorizer?: CloudRunAuthorizer; timeoutMs?: number },
  ) {
    this.fetchImpl = options?.fetchImpl ?? ((url, init) => fetch(url, init));
    this.authorizeUpstream = options?.cloudRunAuthorizer ?? getCloudRunAuthorizationHeader;
    this.timeoutMs = options?.timeoutMs ?? Number(process.env.PROXY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  }

  async dispatch(req: AuthenticatedRequest, res: Response, target: LegacyTarget, legacy: () => Promise<void>): Promise<void> {
    const route = await this.bridge.route({
      sourceServiceId: req.sourceServiceId,
      projectId: req.projectId,
      environment: req.user?.environment,
    });

    if (route.mode === "control-plane") {
      const requestId = req.correlationId || randomUUID();
      const idempotencyKey = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : undefined;
      const call = await this.bridge.authorize(route, target, { requestId, ...(idempotencyKey ? { idempotencyKey } : {}) });
      let baseUrl: string;
      if (target.kind === "capability") {
        baseUrl = resolveSharedServiceRoute(target.capability, route.environmentKind);
      } else {
        baseUrl = call.upstreamUrl as string;
        await assertPublicUpstream(baseUrl, upstreamGuardOptions());
      }
      const status = await forwardSigned({
        req,
        res,
        targetBaseUrl: baseUrl,
        relativePath: target.relativePath,
        signedContext: call.signedContext,
        requestId,
        label: target.kind === "capability" ? `Capability '${target.capability}'` : `Service '${target.legacyServiceId}'`,
        fetchImpl: this.fetchImpl,
        cloudRunAuthorizer: this.authorizeUpstream,
        timeoutMs: this.timeoutMs,
      });
      await this.bridge.recordOutcome(call, status);
      return;
    }

    try {
      await legacy();
      if (route.mode === "shadow") void this.bridge.shadow(route, target, true);
    } catch (error) {
      const status = (error as { status?: number; getStatus?: () => number }).getStatus?.() ?? (error as { status?: number }).status;
      // Only access decisions are compared; quota, availability and upstream errors are not.
      if (route.mode === "shadow" && (status === 401 || status === 403)) void this.bridge.shadow(route, target, false);
      throw error;
    }
  }
}
