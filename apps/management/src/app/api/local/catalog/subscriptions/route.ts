import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import {
  authorizeProject,
  authorizeService,
  managementOrganizationFilter,
} from "@/lib/server/organization-access";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const consumerProjectId = searchParams.get("consumerProjectId");
    const apiServiceId = searchParams.get("apiServiceId");
    if (consumerProjectId) await authorizeProject(request, consumerProjectId);
    if (apiServiceId) await authorizeService(request, apiServiceId);
    const query = new URLSearchParams();
    if (consumerProjectId) query.set("consumerProjectId", consumerProjectId);
    if (apiServiceId) query.set("apiServiceId", apiServiceId);
    if (!consumerProjectId && !apiServiceId) {
      const organizationId = await managementOrganizationFilter(request);
      if (organizationId) query.set("organizationId", organizationId);
    }
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
    const input = await request.clone().json();
    if (typeof input?.consumerProjectId !== "string" || !input.consumerProjectId) {
      return Response.json(
        { success: false, error: "consumerProjectId is required" },
        { status: 400 },
      );
    }
    await authorizeProject(request, input.consumerProjectId, "operator");
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
