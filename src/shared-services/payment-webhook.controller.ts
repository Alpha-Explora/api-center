import {
  Controller,
  HttpCode,
  Post,
  RawBodyRequest,
  Req,
  Res,
} from "@nestjs/common";
import { Request, Response } from "express";
import { RegistryService } from "../registry/registry.service";
import { BadGatewayError, NotFoundError } from "../shared/errors";

@Controller("shared/payment/webhooks")
export class PaymentWebhookController {
  constructor(private readonly registry: RegistryService) {}

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
    const response = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": getHeader(req, "content-type") || "application/json",
        "Paymongo-Signature": getHeader(req, "paymongo-signature"),
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
