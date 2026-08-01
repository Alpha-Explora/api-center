import axios from "axios";
import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { z } from "zod";

const ProductInput = z.object({
  ownerTribeId: z.string().trim().min(1).max(100),
  environment: z.enum(["test", "live"]),
  productId: z.string().trim().min(1).max(150).optional(),
  name: z.string().trim().min(1).max(255),
  description: z.string().max(1000).optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

const PriceInput = z.object({
  ownerTribeId: z.string().trim().min(1).max(100),
  environment: z.enum(["test", "live"]),
  priceId: z.string().trim().min(1).max(150).optional(),
  productId: z.string().trim().min(1).max(150),
  amountMinor: z.number().int().positive(),
  currency: z.literal("PHP"),
  recurring: z
    .object({
      interval: z.enum(["day", "week", "month", "year"]),
      intervalCount: z.number().int().positive().optional(),
      trialPeriodDays: z.number().int().nonnegative().optional(),
    })
    .optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
});

@Injectable()
export class PaymentCatalogManagementService {
  async createProduct(input: unknown): Promise<Record<string, unknown>> {
    const parsed = this.parse(ProductInput, input);
    const result = await this.request("/products", parsed, parsed.ownerTribeId, parsed.environment);
    return this.productView(result);
  }

  async createPrice(input: unknown): Promise<Record<string, unknown>> {
    const parsed = this.parse(PriceInput, input);
    const { ownerTribeId, environment, amountMinor, currency, ...rest } = parsed;
    const result = await this.request(
      "/prices",
      { ...rest, amount: { value: amountMinor, currency } },
      ownerTribeId,
      environment,
    );
    return this.priceView(result);
  }

  private async request(
    path: string,
    body: Record<string, unknown>,
    tribeId: string,
    environment: "test" | "live",
  ): Promise<Record<string, unknown>> {
    const baseUrl = process.env.APICENTER_PAYMENTS_URL;
    const internalToken = process.env.APICENTER_PAYMENTS_INTERNAL_TOKEN;
    if (!baseUrl || !internalToken) {
      throw new ServiceUnavailableException(
        "APICenter payments runtime is not configured for catalog management",
      );
    }

    const response = await axios.post(baseUrl.replace(/\/$/, "") + path, body, {
      headers: {
        "X-APICenter-Internal-Token": internalToken,
        "X-Tribe-ID": tribeId,
        "X-APICenter-Environment": environment,
        "Idempotency-Key": this.idempotencyKey(path, body),
      },
      validateStatus: () => true,
    });
    const payload = response.data as { success?: boolean; data?: Record<string, unknown>; error?: unknown };
    if (response.status >= 400 || !payload.success || !payload.data) {
      const error = new Error("APICenter payment catalog provisioning failed");
      Object.assign(error, { status: response.status, details: payload.error });
      throw error;
    }
    return payload.data;
  }

  private productView(value: Record<string, unknown>): Record<string, unknown> {
    return {
      productId: value.productId,
      name: value.name,
      description: value.description,
      active: value.active,
      metadata: value.metadata,
    };
  }

  private priceView(value: Record<string, unknown>): Record<string, unknown> {
    const amount = value.amount as Record<string, unknown> | undefined;
    return {
      priceId: value.priceId,
      productId: value.productId,
      amountMinor: amount?.value,
      currency: amount?.currency,
      recurring: value.recurring,
      active: value.active,
      metadata: value.metadata,
    };
  }

  private parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
    const result = schema.safeParse(input);
    if (!result.success) {
      const error = new Error("Invalid payment catalog input");
      Object.assign(error, { status: 400, details: result.error.issues });
      throw error;
    }
    return result.data;
  }

  private idempotencyKey(path: string, body: Record<string, unknown>): string {
    return ("catalog:" + path + ":" + JSON.stringify(body)).slice(0, 255);
  }
}
