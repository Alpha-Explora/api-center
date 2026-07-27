import { PaymentConsumerService } from "../../../../lib/payment-consumer-service";

export function managementError(error: unknown): Response {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status) || 500
      : 500;
  const message = error instanceof Error ? error.message : "Management request failed";
  return Response.json({ success: false, error: { message } }, { status });
}

export function requireManagementService(request: Request): PaymentConsumerService | Response {
  const managementToken = process.env.MANAGEMENT_OPERATOR_TOKEN?.trim();
  if (!managementToken) {
    return Response.json(
      { success: false, error: { message: "Management operator authentication is not configured" } },
      { status: 503 },
    );
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${managementToken}`) {
    return Response.json(
      { success: false, error: { message: "Management authentication required" } },
      { status: 401 },
    );
  }

  const gatewayBaseUrl = process.env.APICENTER_GATEWAY_URL?.trim();
  const operatorToken = process.env.APICENTER_OPERATOR_TOKEN?.trim();
  const platformSecret = process.env.APICENTER_PLATFORM_SECRET?.trim();
  if (!gatewayBaseUrl || (!operatorToken && !platformSecret)) {
    return Response.json(
      { success: false, error: { message: "APICenter gateway management credentials are not configured" } },
      { status: 503 },
    );
  }

  return new PaymentConsumerService({
    gatewayBaseUrl,
    ...(operatorToken ? { operatorToken } : {}),
    ...(platformSecret ? { platformSecret } : {}),
  });
}
