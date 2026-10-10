import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { authorizeService } from "@/lib/server/organization-access";

type RouteContext = { params: Promise<{ id: string; action: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id, action } = await context.params;
    if (!["approve", "reject", "revoke"].includes(action)) {
      return Response.json(
        { success: false, error: "Invalid subscription action" },
        { status: 400 },
      );
    }
    const { session } = await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: `catalog.subscription.${action}`,
    });
    const body = await request.json().catch(() => null);
    if (
      !body ||
      typeof body !== "object" ||
      typeof body.apiServiceId !== "string" ||
      !body.apiServiceId.trim()
    ) {
      return Response.json(
        { success: false, error: "apiServiceId is required" },
        { status: 400 },
      );
    }
    await authorizeService(request, body.apiServiceId, "operator");
    return apiCenterAdminRequest(
      `/api/v1/admin/api-subscriptions/${encodeURIComponent(id)}/${action}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { "x-apicenter-actor": session.email },
      },
    );
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "API subscription decision failed.",
    );
  }
}
