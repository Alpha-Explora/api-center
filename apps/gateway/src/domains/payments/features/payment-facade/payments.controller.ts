import {
  All,
  Controller,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
  Req,
  Res,
} from "@nestjs/common";
import axios, { AxiosRequestConfig } from "axios";
import { randomUUID } from "node:crypto";
import { ApplicationAccessService } from "@domains/control-plane/application-access.service";
import { isControlPlaneBearer } from "@domains/control-plane/control-plane.types";
import { z } from "zod";
import { Request, Response } from "express";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { paymentRuntimeToken, paymentRuntimeUrl } from "@shared/proxy/payment-runtime";
import { PaymentIdempotencyService } from "../../shared/payment-idempotency.service";
import { AuthenticatedRequest } from "../../../../types";
import type { PaymentPrincipal } from "../../shared/payment-access.types";
import {
  enabledPaymentMethods,
  paymentRequestBody,
  paymentResponseBody,
  resolvePaymentOperation,
} from "./payment-public-operation";
import { PaymentLimitsService } from "../payment-limits/payment-limits.service";
import { PaymentReturnLinks } from "../payment-return/payment-return-links";

const internalBaseUrl = paymentRuntimeUrl;
const internalToken = paymentRuntimeToken;

/** `deprecatedProviderCode` is returned until this date (ADR-0010; contracts/public/provider-terms.json). */
export const PROVIDER_CODE_SUNSET = "Mon, 01 Mar 2027 00:00:00 GMT";

/** Whether a response still carries the provider's own code, which is deprecated. */
export function usesDeprecatedProviderCode(body: unknown): boolean {
  const record = body && typeof body === "object" ? body as Record<string, any> : {};
  return typeof record.error?.details?.deprecatedProviderCode === "string"
    || typeof record.data?.lastPaymentError?.deprecatedProviderCode === "string";
}
@Controller("payments")
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);

  constructor(
    private readonly idempotency: PaymentIdempotencyService,
    private readonly paymentLimits: PaymentLimitsService,
    private readonly applications: ApplicationAccessService,
    private readonly returnLinks: PaymentReturnLinks,
  ) {}

  @All("*")
  async proxy(@Req() req: Request, @Res() res: Response): Promise<void> {
    const authReq = req as AuthenticatedRequest;
    const fullPath = new URL(req.originalUrl || req.path, "http://localhost")
      .pathname;
    const path =
      fullPath.replace(/^\/api\/v1\/payments/, "").replace(/^\/payments/, "") ||
      "/";
    const operation = resolvePaymentOperation(req.method, path);

    const authorization = req.headers.authorization;
    const bearer = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined;
    if (!bearer || !isControlPlaneBearer(bearer)) {
      res.status(HttpStatus.UNAUTHORIZED).json({
        success: false,
        error: { code: "UNAUTHORIZED", message: "An application key is required" },
      });
      return;
    }
    // The key needs a grant for this operation's action. Records belong to its organization and
    // project.
    const call = await this.applications.authorizeAction({
      bearer,
      capability: "payments",
      action: operation.scope,
      method: req.method,
      requestId: authReq.correlationId || randomUUID(),
      ...(req.get("Idempotency-Key")?.trim() ? { idempotencyKey: req.get("Idempotency-Key")!.trim() } : {}),
    });
    const principal = {
      ownerTribeId: call.resourceOwner.groupId,
      projectId: call.resourceOwner.projectId,
      consumerServiceId: call.identity.applicationId,
      environment: call.identity.environmentKind,
    };
    authReq.caller = call.identity;
    // The request log shows the action this request was authorized for.
    res.locals.diagnosticAction = call.action;
    res.on("finish", () => {
      void this.applications.recordOutcome(call, res.statusCode);
    });

    const env = principal.environment;
    const token = internalToken(env);

    if (operation.resource === "capabilities") {
      res
        .status(200)
        .json({
          success: true,
          data: {
            currency: "PHP",
            paymentMethods: enabledPaymentMethods(env),
            resources: [
              "checkouts",
              "intents",
              "customers",
              "plans",
              "payment-links",
              "refunds",
              "subscriptions",
              "invoices",
              "records",
              "payees",
              "allocations",
              "payouts",
            ],
          },
        });
      return;
    }
    if (!token)
      throw new ServiceUnavailableException(
        "Payment runtime token is not configured",
      );
    const requestOrigin = `https://${req.get("host")}`;
    const runtimeBody = paymentRequestBody(operation.shape, req.body, {
      serviceId: principal.consumerServiceId,
      enabledMethods: enabledPaymentMethods(env),
      returnLink: (url) => this.returnLinks.forProvider(url, requestOrigin),
    });
    const runtimePath =
      req.method.toUpperCase() === "POST" && path === "/refunds"
        ? `/payments/${encodeURIComponent((runtimeBody as { paymentId: string }).paymentId)}/refunds`
        : operation.runtimePath;
    const upstreamUrl = `${internalBaseUrl(env)}${runtimePath}`;

    const amountValue =
      runtimeBody && typeof runtimeBody === "object"
        ? (runtimeBody as Record<string, unknown>).amount
        : undefined;
    await this.paymentLimits.enforce({
      ownerTribeId: principal.ownerTribeId,
      projectId: principal.projectId,
      environment: env,
      method: req.method,
      ...(typeof amountValue === "number" ? { amountMinor: amountValue } : {}),
    });

    const idempotencyKey = req.get("Idempotency-Key")?.trim() || undefined;
    if (operation.resource === "payeeOnboarding") res.setHeader("Cache-Control", "no-store");
    const lookup = await this.idempotency.lookupOrValidate({
      principal,
      method: req.method,
      path,
      key: idempotencyKey,
      body: req.body,
    });

    if ("replay" in lookup) {
      if (lookup.replay.contentType) {
        res.setHeader("content-type", lookup.replay.contentType);
      }
      res.setHeader("x-idempotency-replayed", "true");
      if (lookup.replay.status < 400)
        this.recordResource(res, JSON.parse(lookup.replay.body));
      res.status(lookup.replay.status).send(lookup.replay.body);
      return;
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
      // The runtime scopes records by this signed context once it has the verification keys; the
      // unsigned headers below remain for runtimes that do not have them yet, and must match it.
      "x-apicenter-context": call.signedContext,
      "x-apicenter-environment": env,
      "x-apicenter-consumer-service-id": principal.consumerServiceId,
      "x-apicenter-owner-tribe-id": principal.ownerTribeId,
      "x-apicenter-project-id": principal.projectId,
    };
    headers.authorization = `Bearer ${token}`;
    // The payments runtime reads its internal token from Authorization. Cloud Run
    // checks the caller's Google identity in X-Serverless-Authorization and
    // forwards Authorization to the container unchanged.
    let cloudRunAuthorization: string | undefined;
    try {
      cloudRunAuthorization = await getCloudRunAuthorizationHeader(upstreamUrl);
    } catch (error: unknown) {
      await this.preserveUnknownOutcome({ principal, method: req.method, path, key: idempotencyKey });
      const message = error instanceof Error ? error.message : "Payment upstream authentication unavailable";
      res.status(HttpStatus.BAD_GATEWAY).json({
        success: false,
        error: {
          code: "PAYMENT_UPSTREAM_UNREACHABLE",
          message,
        },
      });
      return;
    }
    if (cloudRunAuthorization) headers["x-serverless-authorization"] = cloudRunAuthorization;
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

    const config: AxiosRequestConfig = {
      method: req.method,
      url: upstreamUrl,
      headers,
      params: req.query,
      data: runtimeBody,
      timeout: Number(process.env.APICENTER_PAYMENTS_TIMEOUT_MS || 15000),
      validateStatus: () => true,
      transformResponse: [(data) => data],
    };

    try {
      const response = await axios.request(config);
      let parsed: unknown;
      try {
        parsed =
          typeof response.data === "string" || Buffer.isBuffer(response.data)
            ? JSON.parse(
                Buffer.isBuffer(response.data)
                  ? response.data.toString("utf8")
                  : response.data,
              )
            : response.data;
      } catch {
        await this.preserveUnknownOutcome({ principal, method: req.method, path, key: idempotencyKey });
        this.logger.error(`Payment runtime returned HTTP ${response.status} with a non-JSON body for ${req.method} ${runtimePath}`);
        res.locals.requestDiagnostic = { code: "PAYMENT_UPSTREAM_INVALID_RESPONSE", stage: "runtime" };
        res.status(HttpStatus.BAD_GATEWAY).json({
          success: false,
          error: {
            code: "PAYMENT_UPSTREAM_INVALID_RESPONSE",
            message: `Payment runtime returned HTTP ${response.status} with a non-JSON body`,
          },
        });
        return;
      }
      const mapped = paymentResponseBody(operation.resource, parsed);
      if (response.status < 400) this.recordResource(res, mapped);
      if (response.status >= 400) {
        const diagnostic = z
          .object({
            error: z.object({
              code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
            }),
          })
          .safeParse(mapped);
        res.locals.requestDiagnostic = {
          code: diagnostic.success
            ? diagnostic.data.error.code
            : "PAYMENT_RUNTIME_ERROR",
          stage:
            diagnostic.success &&
            /^(PROVIDER_|PAYMENT_DECLINED$|PAYMENT_REQUEST_INVALID$|INVALID_PROVIDER_RESPONSE$)/.test(diagnostic.data.error.code)
              ? "provider"
              : "runtime",
        };
      }
      const body = JSON.stringify(mapped);
      const contentType = "application/json";

      if (
        idempotencyKey &&
        req.method.toUpperCase() !== "GET" &&
        response.status < 500
      ) {
        await this.idempotency.store({
          principal,
          method: req.method,
          path,
          key: idempotencyKey,
          body: req.body,
          response: {
            status: response.status,
            contentType,
            body: operation.resource === "payeeOnboarding"
              ? JSON.stringify(paymentResponseBody(operation.resource, parsed, false))
              : body,
          },
        });
      } else if (response.status >= 500) {
        await this.preserveUnknownOutcome({
          principal,
          method: req.method,
          path,
          key: idempotencyKey,
        });
      }

      res.setHeader("content-type", contentType);
      if (usesDeprecatedProviderCode(mapped)) {
        res.setHeader("Deprecation", "true");
        res.setHeader("Sunset", PROVIDER_CODE_SUNSET);
      }
      res.status(response.status).send(body);
    } catch (error: unknown) {
      await this.preserveUnknownOutcome({
        principal,
        method: req.method,
        path,
        key: idempotencyKey,
      });
      const message =
        error instanceof Error ? error.message : "Payment upstream unreachable";
      res.locals.requestDiagnostic = {
        code: "PAYMENT_UPSTREAM_UNREACHABLE",
        stage: "runtime",
      };
      res.status(HttpStatus.BAD_GATEWAY).json({
        success: false,
        error: {
          code: "PAYMENT_UPSTREAM_UNREACHABLE",
          message,
        },
      });
    }
  }

  private recordResource(response: Response, body: unknown): void {
    const parsed = z
      .object({
        success: z.literal(true),
        data: z.record(z.string(), z.unknown()),
      })
      .safeParse(body);
    if (!parsed.success) return;
    for (const field of [
      "checkoutId",
      "paymentIntentId",
      "subscriptionId",
      "invoiceId",
      "refundId",
      "paymentLinkId",
      "customerId",
      "planId",
      // A payout also names its payee, so its own id is checked first.
      "payoutId",
      "allocationId",
      "payeeId",
    ]) {
      const value = parsed.data.data[field];
      if (typeof value === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value)) {
        response.locals.paymentResourceId = value;
        return;
      }
    }
  }

  private async preserveUnknownOutcome(input: {
    principal: PaymentPrincipal;
    method: string;
    path: string;
    key?: string;
  }): Promise<void> {
    try {
      await this.idempotency.markUnknown(input);
    } catch {
      // The durable reservation created before the upstream request remains in
      // place, so stale provider keys still fail closed if the database is unavailable.
      this.logger.error(
        "Unable to update the payment idempotency outcome marker",
      );
    }
  }
}
