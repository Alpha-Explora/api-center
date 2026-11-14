import { requireManagementService, managementError } from "../../route-auth";
import { authorizeService } from "@/lib/server/organization-access";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

export async function POST(
  request: Request,
  context: { params: Promise<{ serviceId: string }> },
): Promise<Response> {
  try {
    const { serviceId } = await context.params;
    await authorizeService(request, serviceId, "operator");
    const service = await requireManagementService();
    if (service instanceof Response) return service;
    const input = await request.clone().json();
    if (input?.environment !== "test" && input?.environment !== "live") {
      return Response.json({ success: false, error: { message: "Environment must be test or live" } }, { status: 400 });
    }
    await requireManagementRouteAction({ request, environment: input.environment, actionRisk: "provider-write", actionId: "payment.consumer.rotate-key" });
    const result = await service.rotatePaymentApiKey(serviceId, input);
    return Response.json({ success: true, data: result });
  } catch (error) {
    return managementError(error);
  }
}
