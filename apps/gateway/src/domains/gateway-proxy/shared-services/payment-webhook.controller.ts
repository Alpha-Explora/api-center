import {
  Controller,
  HttpCode,
  Param,
  Post,
  RawBodyRequest,
  Req,
  Res,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Request, Response } from "express";
import { AuditEventsService } from "@analytics/audit-events.service";
import { ConfigService } from "@config/config.service";
import { RegistryService } from "@registry/registry.service";
import {
  BadGatewayError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "@shared/errors";
import {
  ApicenterRuntimeEnvironment,
  isApicenterRuntimeEnvironment,
} from "../../../types";
import { getCloudRunAuthorizationHeader } from "@shared/proxy/cloud-run-auth";
import { SharedServiceRoutingService } from "./shared-service-routing.service";

@Controller("shared/payment/webhooks")
export class PaymentWebhookController {
  constructor(
    private readonly registry: RegistryService,
    private readonly config: ConfigService,
    private readonly auditEvents: AuditEventsService,
    private readonly sharedServiceRouting: SharedServiceRoutingService,
  ) {}

  @Post(":environment")
  @HttpCode(200)
  async forwardPayMongoWebhook(
    @Param("environment") environment: string,
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const targetEnvironment = resolveWebhookEnvironment(environment);
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const signatureHeader = getHeader(req, "paymongo-signature");
    assertValidPayMongoSignature(
      rawBody,
      signatureHeader,
      resolvePayMongoWebhookSecret(this.config, targetEnvironment),
      targetEnvironment,
    );

    const upstream = this.resolvePaymentWebhookUpstream(targetEnvironment);
    const providerEventId = resolveProviderEventId(req.body, rawBody);
    const providerEventKey = {
      environment: targetEnvironment,
      provider: "paymongo",
      providerEventId,
    };

    await this.auditEvents.record({
      type: "shared_service.webhook.received",
      actionFamily: "shared_service",
      sharedServiceId: "payment",
      severity: "info",
      message:
        "PayMongo webhook accepted for payment shared service forwarding",
      payload: {
        environment: targetEnvironment,
        provider: "paymongo",
        providerEventKey,
        route: `/webhooks/${targetEnvironment}`,
        upstream,
        contentType: getHeader(req, "content-type") || "application/json",
        rawBodyBytes: rawBody.length,
        signaturePresent: Boolean(signatureHeader),
      },
    });

    const cloudRunAuthorization =
      await getCloudRunAuthorizationHeader(upstream);
    const headers: Record<string, string> = {
      "Content-Type": getHeader(req, "content-type") || "application/json",
      "Paymongo-Signature": signatureHeader,
      "X-APICenter-Environment": targetEnvironment,
    };
    if (cloudRunAuthorization) {
      headers.Authorization = cloudRunAuthorization;
    }
    const internalToken = targetEnvironment === "live"
      ? process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_LIVE
      : process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN_TEST;
    if (internalToken || process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN) {
      headers["X-APICenter-Internal-Token"] = internalToken || process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN!;
    }

    const response = await fetch(upstream, {
      method: "POST",
      headers,
      body: rawBody,
    }).catch((err) => {
      throw new BadGatewayError(
        `Payment webhook upstream unavailable: ${(err as Error).message}`,
      );
    });

    const text = await response.text();
    res?.status(response.status);

    if (!text) {
      return {};
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return JSON.parse(text);
    }

    return text;
  }

  private resolvePaymentWebhookUpstream(
    environment: ApicenterRuntimeEnvironment,
  ): string {
    const configuredTarget = environment === "live"
      ? process.env.SHARED_SERVICE_ROUTE_PAYMENT_LIVE || process.env.APICENTER_PAYMENTS_URL
      : process.env.SHARED_SERVICE_ROUTE_PAYMENT_TEST || process.env.APICENTER_PAYMENTS_URL;
    if (configuredTarget) {
      return `${configuredTarget.replace(/\/+$/, "")}/webhooks`;
    }

    const targetUrl = this.sharedServiceRouting.resolve(
      "payment",
      environment,
    ).targetUrl;
    if (!targetUrl) {
      throw new NotFoundError("Payment runtime is not configured");
    }

    return `${targetUrl.replace(/\/+$/, "")}/webhooks`;
  }
}

function resolveWebhookEnvironment(
  environment: string,
): ApicenterRuntimeEnvironment {
  if (!isApicenterRuntimeEnvironment(environment)) {
    throw new NotFoundError("Payment webhook environment must be test or live");
  }

  return environment;
}

function resolvePayMongoWebhookSecret(
  config: ConfigService,
  environment: ApicenterRuntimeEnvironment,
): string {
  return environment === "live"
    ? config.paymentWebhooks.paymongoLiveSecret
    : config.paymentWebhooks.paymongoTestSecret;
}

function getHeader(req: Request, name: string): string {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.join(",");
  }

  return value ?? "";
}

function assertValidPayMongoSignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
  environment: ApicenterRuntimeEnvironment,
): void {
  if (!secret) {
    const expectedKey =
      environment === "live"
        ? "PAYMONGO_LIVE_WEBHOOK_SECRET"
        : "PAYMONGO_TEST_WEBHOOK_SECRET";
    throw new ServiceUnavailableError(`${expectedKey} is not configured`);
  }

  const values = parsePayMongoSignature(signatureHeader);
  const timestamp = values.get("t")?.[0];
  const signatureField = environment === "live" ? "li" : "te";
  const signatures = values.get(signatureField)?.filter(Boolean) ?? [];

  if (!timestamp || signatures.length === 0) {
    throw new UnauthorizedError("Invalid PayMongo webhook signature");
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");

  if (
    !signatures.some((signature) => timingSafeHexEqual(signature, expected))
  ) {
    throw new UnauthorizedError("Invalid PayMongo webhook signature");
  }
}

function resolveProviderEventId(body: unknown, rawBody: Buffer): string {
  const providerEventId = (body as { data?: { id?: unknown } } | undefined)
    ?.data?.id;
  if (typeof providerEventId === "string" && providerEventId.trim()) {
    return providerEventId;
  }

  return createHmac("sha256", "apicenter-payment-webhook-event")
    .update(rawBody)
    .digest("hex");
}

function parsePayMongoSignature(header: string): Map<string, string[]> {
  const parsed = new Map<string, string[]>();

  for (const part of header.split(",")) {
    const [key, ...valueParts] = part.split("=");
    const name = key?.trim();
    const value = valueParts.join("=").trim();
    if (!name || !value) continue;

    const values = parsed.get(name) ?? [];
    values.push(value);
    parsed.set(name, values);
  }

  return parsed;
}

function timingSafeHexEqual(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (candidateBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(candidateBuffer, expectedBuffer);
}
