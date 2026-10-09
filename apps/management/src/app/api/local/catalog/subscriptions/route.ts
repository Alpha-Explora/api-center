import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { requireManagementSession } from "@/lib/server/require-management-session";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";

export async function GET(request: Request) {
  try {
    await requireManagementSession({
      authorizationHeader: request.headers.get("authorization"),
    });
    const { searchParams } = new URL(request.url);
    const consumerProjectId = searchParams.get("consumerProjectId");
    const apiServiceId = searchParams.get("apiServiceId");
    const query = new URLSearchParams();
    if (consumerProjectId) query.set("consumerProjectId", consumerProjectId);
    if (apiServiceId) query.set("apiServiceId", apiServiceId);
    return apiCenterAdminRequest(`/api/v1/admin/api-subscriptions?${query}`);
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "API subscription request failed.",
    );
  }
}

export async function POST(request: Request) {
  try {
    const { session } = await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "catalog.subscription.request",
    });
    const body = await request.text();
    return apiCenterAdminRequest("/api/v1/admin/api-subscriptions", {
      method: "POST",
      body,
      headers: { "x-apicenter-actor": session.email },
    });
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "API subscription request failed.",
    );
  }
}
