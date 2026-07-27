import { z } from "zod";

const PaymentScope = z.enum(["payments:read", "payments:write"]);
const RegisterInput = z.object({
  ownerTribeId: z.string().trim().min(1).max(100),
  consumerServiceId: z.string().trim().min(1).max(150),
  environment: z.enum(["test", "live"]),
  eventEndpointUrl: z.string().url().refine((value) => value.startsWith("https://")).optional(),
  scopes: z.array(PaymentScope).min(1).default(["payments:read", "payments:write"]),
  pushEndpoint: z.string().url().refine((value) => value.startsWith("https://")).optional(),
  oidcAudience: z.string().url().optional(),
  deliveryServiceAccountEmail: z.string().email().optional(),
  consumerProjectId: z.string().trim().min(1).optional(),
  cloudRunRegion: z.string().trim().min(1).optional(),
  cloudRunServiceName: z.string().trim().min(1).optional(),
});

const RotateInput = z.object({
  ownerTribeId: z.string().trim().min(1).max(100),
  environment: z.enum(["test", "live"]),
  eventEndpointUrl: z.string().url().refine((value) => value.startsWith("https://")).optional(),
  scopes: z.array(PaymentScope).min(1).default(["payments:read", "payments:write"]),
});

const DeliveryInput = z.object({
  ownerTribeId: z.string().trim().min(1).max(100),
  consumerServiceId: z.string().trim().min(1).max(150),
  environment: z.enum(["test", "live"]),
  pushEndpoint: z.string().url().refine((value) => value.startsWith("https://")),
  oidcAudience: z.string().url().optional(),
  deliveryServiceAccountEmail: z.string().email(),
  consumerProjectId: z.string().trim().min(1).optional(),
  cloudRunRegion: z.string().trim().min(1).optional(),
  cloudRunServiceName: z.string().trim().min(1).optional(),
});

export type PaymentConsumerInput = z.input<typeof RegisterInput>;
export type PaymentDeliveryStatus = "pending_validation" | "active" | "delivery_failed" | "revoked";
export type PaymentConsumerRegistration = {
  ownerTribeId: string;
  consumerServiceId: string;
  environment: "test" | "live";
  apiKey: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked";
  eventDelivery?: {
    status: PaymentDeliveryStatus;
    subscriptionName?: string;
    topicName?: string;
    lastDeliveryAt: string | null;
    deadLetterCount: number | null;
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
      scopes: parsed.scopes,
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
            ...(parsed.consumerProjectId ? { consumerProjectId: parsed.consumerProjectId } : {}),
            ...(parsed.cloudRunRegion ? { cloudRunRegion: parsed.cloudRunRegion } : {}),
            ...(parsed.cloudRunServiceName ? { cloudRunServiceName: parsed.cloudRunServiceName } : {}),
          })
        : undefined;

    return {
      ...this.registrationFields(registration),
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
      { ...parsed, consumerServiceId },
    );
    return this.registrationFields(registration);
  }

  async provisionEventDelivery(input: unknown): Promise<NonNullable<PaymentConsumerRegistration["eventDelivery"]>> {
    const parsed = this.parse(DeliveryInput, input);
    const result = await this.post("/admin/payments/events/consumers", parsed);
    const iam = result.iam as { status?: string } | undefined;
    return {
      status: iam?.status === "applied" ? "active" : "pending_validation",
      ...(typeof result.subscriptionName === "string" ? { subscriptionName: result.subscriptionName } : {}),
      ...(typeof result.topicName === "string" ? { topicName: result.topicName } : {}),
      lastDeliveryAt: null,
      deadLetterCount: null,
    };
  }

  private registrationFields(value: Record<string, unknown>): PaymentConsumerRegistration {
    const apiKey = this.stringField(value, "apiKey");
    const scopes = value.scopes;
    if (!Array.isArray(scopes) || scopes.some((scope) => typeof scope !== "string")) {
      throw new PaymentConsumerManagementError("APICenter response has invalid scopes", 502);
    }
    return {
      ownerTribeId: this.stringField(value, "ownerTribeId"),
      consumerServiceId: this.stringField(value, "consumerServiceId"),
      environment: this.enumField(value, "environment"),
      apiKey,
      keyPrefix: this.stringField(value, "keyPrefix", apiKey.slice(0, 16)),
      scopes,
      createdAt: this.stringField(value, "createdAt"),
      expiresAt: this.nullableStringField(value, "expiresAt"),
      revokedAt: this.nullableStringField(value, "revokedAt"),
      status: value.status === "revoked" ? "revoked" : "active",
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
    const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
    if (this.options.platformSecret) headers["X-Platform-Secret"] = this.options.platformSecret;
    else headers.Authorization = `Bearer ${this.options.operatorToken}`;

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
      throw new PaymentConsumerManagementError("APICenter consumer provisioning failed", response.status, envelope.error);
    }
    return envelope.data as Record<string, unknown>;
  }

  private stringField(value: Record<string, unknown>, field: string, fallback?: string): string {
    const fieldValue = value[field] ?? fallback;
    if (typeof fieldValue !== "string" || !fieldValue) {
      throw new PaymentConsumerManagementError(`APICenter response missing ${field}`, 502);
    }
    return fieldValue;
  }

  private nullableStringField(value: Record<string, unknown>, field: string): string | null {
    const fieldValue = value[field];
    if (fieldValue === null || fieldValue === undefined) return null;
    if (typeof fieldValue !== "string") {
      throw new PaymentConsumerManagementError(`APICenter response has invalid ${field}`, 502);
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