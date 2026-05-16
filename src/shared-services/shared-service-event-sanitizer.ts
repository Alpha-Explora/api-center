import { createHash } from "node:crypto";

type SanitizerInput = {
  sharedServiceId: string;
  route: string;
  requestBody?: unknown;
  responseBody?: unknown;
};

type SanitizedEventData = {
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  redactions: string[];
};

const REDACTED_KEYS = new Set([
  "authorization",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "apikey",
  "password",
  "code",
  "otp",
  "message",
  "text",
  "html",
  "email",
  "phone",
  "to",
  "from",
]);

export function sanitizeSharedServiceEventInput(
  input: SanitizerInput,
): SanitizedEventData {
  const requestBody = asRecord(input.requestBody);
  const responseBody = asRecord(input.responseBody);
  const responseData = asRecord(responseBody.data);
  const redactions = [
    ...collectRedactions(requestBody, "request"),
    ...collectRedactions(responseBody, "response"),
  ];

  const request = sanitizeRequest(
    input.sharedServiceId,
    input.route,
    requestBody,
  );
  const response = sanitizeResponse(input.sharedServiceId, responseData);

  return {
    request,
    response,
    redactions: [...new Set(redactions)].sort(),
  };
}

function sanitizeRequest(
  sharedServiceId: string,
  route: string,
  body: Record<string, unknown>,
): Record<string, unknown> {
  if (sharedServiceId === "sms") {
    return {
      recipientHash: hashOptional(body.to),
      hasMessage: typeof body.message === "string" && body.message.length > 0,
    };
  }

  if (sharedServiceId === "email") {
    return {
      recipientHash: hashOptional(body.to),
      subjectPresent:
        typeof body.subject === "string" && body.subject.length > 0,
      hasHtml: typeof body.html === "string" && body.html.length > 0,
      hasText: typeof body.text === "string" && body.text.length > 0,
    };
  }

  if (sharedServiceId === "payment") {
    const lineItems = Array.isArray(body.lineItems) ? body.lineItems : [];
    const totals = getPaymentTotal(lineItems);
    return {
      referenceId: stringOrUndefined(body.referenceId),
      idempotencyKeyHash: hashOptional(body.idempotencyKey),
      amount: totals.amount,
      currency: totals.currency,
      lineItemCount: lineItems.length,
    };
  }

  if (sharedServiceId === "otp") {
    return {
      targetHash: hashOptional(body.target),
      channel: stringOrUndefined(body.channel),
      length: numberOrUndefined(body.length),
      expiresInSeconds: numberOrUndefined(body.expiresInSeconds),
    };
  }

  if (sharedServiceId === "geo") {
    return {
      operation: route.replace(/^\/+/, "").split("/")[0] || "unknown",
      latitudeRounded: roundCoordinate(body.latitude),
      longitudeRounded: roundCoordinate(body.longitude),
      addressHash: hashOptional(body.address),
    };
  }

  if (sharedServiceId === "gauth") {
    return {
      scopes: Array.isArray(body.scopes)
        ? body.scopes.filter(
            (scope): scope is string => typeof scope === "string",
          )
        : [],
      redirectUriHost: getUrlHost(body.redirectUri),
      stateHash: hashOptional(body.state),
    };
  }

  return {};
}

function sanitizeResponse(
  sharedServiceId: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (sharedServiceId === "sms" || sharedServiceId === "email") {
    return {
      messageId: stringOrUndefined(data.messageId),
      status: stringOrUndefined(data.status),
      provider: stringOrUndefined(data.provider),
    };
  }

  if (sharedServiceId === "payment") {
    return {
      checkoutId: stringOrUndefined(data.checkoutId),
      paymentId: stringOrUndefined(data.paymentId),
      status: stringOrUndefined(data.status),
      provider: stringOrUndefined(data.provider),
    };
  }

  if (sharedServiceId === "otp") {
    return {
      otpId: stringOrUndefined(data.otpId),
      channel: stringOrUndefined(data.channel),
      status: stringOrUndefined(data.status),
    };
  }

  if (sharedServiceId === "geo") {
    return {
      provider: stringOrUndefined(data.provider),
      formattedAddressHash: hashOptional(data.formattedAddress),
      inside:
        typeof data.inside === "boolean"
          ? data.inside
          : typeof data.isInside === "boolean"
            ? data.isInside
            : undefined,
    };
  }

  if (sharedServiceId === "gauth") {
    return {
      hasAuthorizationUrl:
        typeof data.authorizationUrl === "string" &&
        data.authorizationUrl.length > 0,
      provider: stringOrUndefined(data.provider),
    };
  }

  return {};
}

function collectRedactions(value: unknown, path: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectRedactions(item, `${path}.${index}`),
    );
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, nested]) => {
      const currentPath = `${path}.${key}`;
      if (REDACTED_KEYS.has(key.toLowerCase())) {
        return [currentPath];
      }
      return collectRedactions(nested, currentPath);
    },
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function hashOptional(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function roundCoordinate(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Number(value.toFixed(4));
}

function getUrlHost(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return undefined;
  }
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function getPaymentTotal(lineItems: unknown[]): {
  amount?: number;
  currency?: string;
} {
  let amount = 0;
  let currency: string | undefined;

  for (const item of lineItems) {
    const record = asRecord(item);
    const amountRecord = asRecord(record.amount);
    const value = numberOrUndefined(amountRecord.value);
    const quantity = numberOrUndefined(record.quantity) ?? 1;
    if (value) {
      amount += value * quantity;
    }
    currency = currency ?? stringOrUndefined(amountRecord.currency);
  }

  return {
    amount: amount > 0 ? amount : undefined,
    currency,
  };
}
