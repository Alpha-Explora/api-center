import { authorizeService } from "@/lib/server/organization-access";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";

export async function GET(
  request: Request,
  context: { params: Promise<{ serviceId: string }> },
) {
  try {
    const { serviceId } = await context.params;
    await authorizeService(request, serviceId, "observer");
    const input = new URL(request.url).searchParams;
    const environment = input.get("environment");
    if (environment !== "test" && environment !== "live")
      return Response.json(
        { error: "Environment must be test or live" },
        { status: 400 },
      );
    const query = new URLSearchParams({
      serviceId,
      environment,
      from:
        input.get("from") ?? new Date(Date.now() - 86_400_000).toISOString(),
      to: input.get("to") ?? new Date().toISOString(),
      limit: "50",
    });
    if (input.has("correlationId"))
      query.set("correlationId", input.get("correlationId") ?? "");
    return apiCenterAdminRequest(`/api/v1/admin/operations/requests?${query}`);
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "Request diagnostics unavailable",
    );
  }
}
