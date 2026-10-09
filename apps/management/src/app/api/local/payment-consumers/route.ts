import { requireManagementService, managementError } from "./route-auth";
import { authorizeService, managementOrganizationFilter } from "@/lib/server/organization-access";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

export async function GET(request: Request): Promise<Response> {
  try {
    const organizationId = await managementOrganizationFilter(request);
    const suffix = organizationId ? `?organizationId=${encodeURIComponent(organizationId)}` : "";
    return apiCenterAdminRequest(`/api/v1/admin/payments/consumers${suffix}`);
  } catch (error) {
    return managementError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const input = await request.json();
    if (!input || typeof input.consumerServiceId !== "string") {
      return Response.json({ success: false, error: { message: "Organization scope could not be resolved" } }, { status: 503 });
    }
    await authorizeService(request, input.consumerServiceId, "operator");
    const service = await requireManagementService();
    if (service instanceof Response) return service;
    await requireManagementRouteAction({ request, actionRisk: "provider-write", actionId: "payment.consumer.provision" });
    const result = await service.registerPaymentConsumer(input);
    return Response.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    return managementError(error);
  }
}
