import { PaymentConsumerService } from "../../../../lib/payment-consumer-service";

export function managementError(error: unknown): Response {
  const explicitStatus =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status) || undefined
      : undefined;
  const message =
    error instanceof Error ? error.message : "Management request failed";
  const status =
    explicitStatus ??
    (message.includes("Organization access denied") || message.includes("Platform administrator required") ? 403 : undefined) ??
    (message.includes("Organization scope could not be resolved") ? 503 : undefined) ??
    (message.toLowerCase().includes("authentication required") ? 401 : 500);

  return Response.json({ success: false, error: { message } }, { status });
}

export async function requireManagementService(
): Promise<PaymentConsumerService | Response> {
  const gatewayBaseUrl =
    process.env.APICENTER_GATEWAY_URL?.trim() ??
    process.env.API_CENTER_BASE_URL?.trim();
  const operatorToken = process.env.APICENTER_OPERATOR_TOKEN?.trim();
  const platformSecret =
    process.env.APICENTER_PLATFORM_SECRET?.trim() ??
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET?.trim();

  if (!gatewayBaseUrl || (!operatorToken && !platformSecret)) {
    return Response.json(
      {
        success: false,
        error: {
          message:
            "APICenter gateway management credentials are not configured",
        },
      },
      { status: 503 },
    );
  }

  return new PaymentConsumerService({
    gatewayBaseUrl,
    ...(operatorToken ? { operatorToken } : {}),
    ...(platformSecret ? { platformSecret } : {}),
  });
}
