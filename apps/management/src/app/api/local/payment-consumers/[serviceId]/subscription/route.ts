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
    await requireManagementRouteAction({ request, actionRisk: "provider-write", actionId: "payment.consumer.subscription" });
    const body = await request.json();
    const result = await service.provisionEventDelivery({
      ...body,
      consumerServiceId: serviceId,
    });
    return Response.json({ success: true, data: result });
  } catch (error) {
    return managementError(error);
  }
}
