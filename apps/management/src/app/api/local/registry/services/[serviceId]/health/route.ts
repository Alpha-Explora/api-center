import { apiCenterAdminJson } from "@/lib/server/api-center-admin";
import { registryDetailResponseSchema } from "@/lib/schemas";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { authorizeService } from "@/lib/server/organization-access";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";

type Context = {
  params: Promise<{ serviceId: string }>;
};

export async function POST(request: Request, context: Context) {
  const { serviceId } = await context.params;
  const checkedAt = new Date().toISOString();
  try {
    await authorizeService(request, serviceId, "operator");
    await requireManagementRouteAction({ request, actionRisk: "low-write", actionId: "registry.service.health-check" });
  } catch (error) {
    return managementRouteErrorResponse(error, "Service health check is not authorized.");
  }

  try {
    const detail = await apiCenterAdminJson<unknown>(
      `/api/v1/registry/services/${encodeURIComponent(serviceId)}`,
    );
    const service = registryDetailResponseSchema.parse(detail).data;
    const healthPath = service.healthCheck || "/health";
    const url = new URL(healthPath, `${service.baseUrl.replace(/\/$/, "")}/`)
      .toString();

    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });

    return Response.json({
      serviceId,
      checkedAt,
      ok: response.ok,
      status: response.status,
      url,
    });
  } catch (error) {
    return Response.json({
      serviceId,
      checkedAt,
      ok: false,
      url: "",
      error:
        error instanceof Error ? error.message : "Health check failed",
    });
  }
}
