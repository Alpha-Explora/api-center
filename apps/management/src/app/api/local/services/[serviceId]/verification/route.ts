import { z } from "zod";
import { authorizeService } from "@/lib/server/organization-access";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
export async function POST(
  request: Request,
  context: { params: Promise<{ serviceId: string }> },
) {
  try {
    const { serviceId } = await context.params;
    await authorizeService(request, serviceId, "operator");
    const input = z
      .object({ environment: z.enum(["test", "live"]) })
      .safeParse(await request.clone().json());
    if (!input.success)
      return Response.json(
        { error: "Environment must be test or live" },
        { status: 400 },
      );
    await requireManagementRouteAction({
      request,
      environment: input.data.environment,
      actionRisk: "state-write",
      actionId: "service.verification.request",
    });
    return apiCenterAdminRequest("/api/v1/admin/operations/verification/runs", {
      method: "POST",
      body: JSON.stringify({ serviceId, environment: input.data.environment }),
    });
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "Verification could not be queued",
    );
  }
}
