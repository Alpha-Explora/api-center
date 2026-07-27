import { PaymentConsumerService } from "../../../../lib/payment-consumer-service";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

export function managementError(error: unknown): Response {
  const explicitStatus =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status) || undefined
      : undefined;
  const message =
    error instanceof Error ? error.message : "Management request failed";
  const status =
    explicitStatus ??
    (message.toLowerCase().includes("authentication required") ? 401 : 500);

  return Response.json({ success: false, error: { message } }, { status });
}

export async function requireManagementService(
  request: Request,
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

  try {
    await requireManagementRouteAction({
      request,
      actionRisk: "provider-write",
      actionId: "payment.consumer.provision",
    });
  } catch (error) {
    return managementError(error);
  }

  return new PaymentConsumerService({
    gatewayBaseUrl,
    ...(operatorToken ? { operatorToken } : {}),
    ...(platformSecret ? { platformSecret } : {}),
  });
}