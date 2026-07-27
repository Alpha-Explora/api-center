import { z } from "zod";

const RegisterInput = z.object({
  ownerTribeId: z.string().trim().min(1).max(100),
  consumerServiceId: z.string().trim().min(1).max(150),
  environment: z.enum(["test", "live"]),
  eventEndpointUrl: z.string().url().refine((value) => value.startsWith("https://")).optional(),
  pushEndpoint: z.string().url().refine((value) => value.startsWith("https://")).optional(),
  oidcAudience: z.string().url().optional(),
  deliveryServiceAccountEmail: z.string().email().optional(),
});

const RotateInput = z.object({
  ownerTribeId: z.string().trim().min(1).max(100),
  environment: z.enum(["test", "live"]),
  eventEndpointUrl: z.string().url().refine((value) => value.startsWith("https://")).optional(),
});

const DeliveryInput = z.object({
  ownerTribeId: z.string().trim().min(1).max(100),
  consumerServiceId: z.string().trim().min(1).max(150),
  environment: z.enum(["test", "live"]),
  pushEndpoint: z.string().url().refine((value) => value.startsWith("https://")),
  oidcAudience: z.string().url().optional(),
  deliveryServiceAccountEmail: z.string().email(),
});

export type PaymentConsumerInput = z.input<typeof RegisterInput>;
export type PaymentConsumerRegistration = {
  ownerTribeId: string;
  consumerServiceId: string;
  environment: "test" | "live";
  apiKey: string;
  keyPrefix: string;
  eventDelivery?: {
    status: "active";
    subscriptionName?: string;
    topicName?: string;
  };
};

export class PaymentConsumerManagementError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "PaymentConsumerManagementError";
  }
}

export interface PaymentConsumerServiceOptions {
  gatewayBaseUrl: string;
  operatorToken?: string;
  platformSecret?: string;
  fetchImpl?: typeof fetch;
}

export class PaymentConsumerService {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: PaymentConsumerServiceOptions) {
    if (!options.gatewayBaseUrl.trim()) throw new TypeError("gatewayBaseUrl is required");
    if (!options.operatorToken?.trim() && !options.platformSecret?.trim()) {
      throw new TypeError("operatorToken or platformSecret is required");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async registerPaymentConsumer(input: unknown): Promise<PaymentConsumerRegistration> {
    const parsed = this.parse(RegisterInput, input);
    const registration = await this.post("/admin/payments/consumers", {
      ownerTribeId: parsed.ownerTribeId,
      consumerServiceId: parsed.consumerServiceId,
      environment: parsed.environment,
      ...(parsed.eventEndpointUrl ? { eventEndpointUrl: parsed.eventEndpointUrl } : {}),
    });

    const delivery =
      parsed.pushEndpoint && parsed.deliveryServiceAccountEmail
        ? await this.provisionEventDelivery({
            ownerTribeId: parsed.ownerTribeId,
            consumerServiceId: parsed.consumerServiceId,
            environment: parsed.environment,
            pushEndpoint: parsed.pushEndpoint,
            ...(parsed.oidcAudience ? { oidcAudience: parsed.oidcAudience } : {}),
            deliveryServiceAccountEmail: parsed.deliveryServiceAccountEmail,
          })
        : undefined;

    return {
      ownerTribeId: this.stringField(registration, "ownerTribeId"),
      consumerServiceId: this.stringField(registration, "consumerServiceId"),
      environment: this.enumField(registration, "environment"),
      apiKey: this.stringField(registration, "apiKey"),
      keyPrefix: this.stringField(registration, "apiKey").slice(0, 16),
      ...(delivery ? { eventDelivery: delivery } : {}),
    };
  }

  async rotatePaymentApiKey(
    consumerServiceId: string,
    input: unknown,
  ): Promise<PaymentConsumerRegistration> {
    const parsed = this.parse(RotateInput, input);
    const registration = await this.post(
      `/admin/payments/consumers/${encodeURIComponent(consumerServiceId)}/keys/rotate`,
      {
        ...parsed,
        consumerServiceId,
      },
    );

    return {
      ownerTribeId: this.stringField(registration, "ownerTribeId"),
      consumerServiceId: this.stringField(registration, "consumerServiceId"),
      environment: this.enumField(registration, "environment"),
      apiKey: this.stringField(registration, "apiKey"),
      keyPrefix: this.stringField(registration, "apiKey").slice(0, 16),
    };
  }

  async provisionEventDelivery(input: unknown): Promise<{
    status: "active";
    subscriptionName?: string;
    topicName?: string;
  }> {
    const parsed = this.parse(DeliveryInput, input);
    const result = await this.post("/admin/payments/events/consumers", parsed);
    return {
      status: "active",
      ...(typeof result.subscriptionName === "string"
        ? { subscriptionName: result.subscriptionName }
        : {}),
      ...(typeof result.topicName === "string" ? { topicName: result.topicName } : {}),
    };
  }

  private parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.output<T> {
    const result = schema.safeParse(input);
    if (!result.success) {
      throw new PaymentConsumerManagementError("Invalid payment consumer input", 400, result.error.issues);
    }
    return result.data;
  }

  private async post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (this.options.platformSecret) {
      headers["X-Platform-Secret"] = this.options.platformSecret;
    } else {
      headers.Authorization = `Bearer ${this.options.operatorToken}`;
    }

    const response = await this.fetchImpl(
      `${this.options.gatewayBaseUrl.replace(/\/$/, "")}/api/v1${path}`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new PaymentConsumerManagementError(
        `APICenter management returned invalid JSON (${response.status})`,
        response.status,
      );
    }

    const envelope = payload as { success?: boolean; data?: unknown; error?: unknown };
    if (!response.ok || envelope.success !== true || !envelope.data || typeof envelope.data !== "object") {
      throw new PaymentConsumerManagementError(
        "APICenter consumer provisioning failed",
        response.status,
        envelope.error,
      );
    }

    return envelope.data as Record<string, unknown>;
  }

  private stringField(value: Record<string, unknown>, field: string): string {
    const fieldValue = value[field];
    if (typeof fieldValue !== "string" || !fieldValue) {
      throw new PaymentConsumerManagementError(`APICenter response missing ${field}`, 502);
    }
    return fieldValue;
  }

  private enumField(value: Record<string, unknown>, field: string): "test" | "live" {
    const fieldValue = this.stringField(value, field);
    if (fieldValue !== "test" && fieldValue !== "live") {
      throw new PaymentConsumerManagementError(`APICenter response has invalid ${field}`, 502);
    }
    return fieldValue;
  }
}
