import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementPlatformAdmin } from "@/lib/server/require-management-platform-admin";

type RouteContext = { params: Promise<{ serviceId: string; version: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    await requireManagementPlatformAdmin(request);
    const { serviceId, version } = await context.params;
    const upstream = await apiCenterAdminRequest(
      `/api/v1/admin/catalog/services/${encodeURIComponent(serviceId)}/spec-versions/${encodeURIComponent(version)}`,
    );
    if (!upstream.ok) return upstream;

    const payload = (await upstream.json()) as {
      data?: { document?: unknown; version?: string };
    };
    if (new URL(request.url).searchParams.get("download") === "1") {
      const filename =
        `${serviceId}-${payload.data?.version ?? version}.json`.replace(
          /[^a-zA-Z0-9._-]/g,
          "_",
        );
      return new Response(
        `${JSON.stringify(payload.data?.document ?? {}, null, 2)}\n`,
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "content-disposition": `attachment; filename="${filename}"`,
          },
        },
      );
    }
    return Response.json(payload);
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "Service specification request failed.",
    );
  }
}
