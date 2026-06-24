import {
  Controller,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
  Res,
} from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Request, Response } from "express";
import { ConfigService } from "../config/config.service";
import { RegistryService } from "../registry/registry.service";
import {
  BadGatewayError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from "../shared/errors";

@Controller("shared/payment/webhooks")
export class PaymentWebhookController {
  constructor(
    private readonly registry: RegistryService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  async forwardPayMongoWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const upstream = this.registry.resolveUpstream("payment", "/webhooks");
    if (!upstream) {
      throw new NotFoundError("Payment shared service is not registered");
    }

    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const signatureHeader = getHeader(req, "paymongo-signature");
    assertValidPayMongoSignature(
      rawBody,
      signatureHeader,
      this.config.paymentWebhooks.paymongoSecret,
    );

    const response = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": getHeader(req, "content-type") || "application/json",
        "Paymongo-Signature": signatureHeader,
      },
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
): void {
  if (!secret) {
    throw new ServiceUnavailableError("PayMongo webhook secret is not configured");
  }

  const values = parsePayMongoSignature(signatureHeader);
  const timestamp = values.get("t")?.[0];
  const signatures = [
    ...(values.get("li") ?? []),
    ...(values.get("te") ?? []),
  ].filter(Boolean);

  if (!timestamp || signatures.length === 0) {
    throw new UnauthorizedError("Invalid PayMongo webhook signature");
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody.toString("utf8")}`)
    .digest("hex");

  if (!signatures.some((signature) => timingSafeHexEqual(signature, expected))) {
    throw new UnauthorizedError("Invalid PayMongo webhook signature");
  }
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
