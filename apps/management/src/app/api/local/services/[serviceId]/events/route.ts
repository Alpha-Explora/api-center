import { z } from "zod";
import { authorizeService } from "@/lib/server/organization-access";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";

export async function GET(
  request: Request,
  context: { params: Promise<{ serviceId: string }> },
) {
  try {
    const { serviceId } = await context.params;
    await authorizeService(request, serviceId, "observer");
    const environment = new URL(request.url).searchParams.get("environment");
    if (environment !== "test" && environment !== "live")
      return Response.json(
        { error: "Environment must be test or live" },
        { status: 400 },
      );
    return apiCenterAdminRequest(
      `/api/v1/admin/payments/events/${encodeURIComponent(serviceId)}?environment=${environment}`,
    );
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "Event delivery state unavailable",
    );
  }
}
const replay = z.object({
  environment: z.enum(["test", "live"]),
  eventId: z.string().uuid(),
  operationId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});
export async function POST(
  request: Request,
  context: { params: Promise<{ serviceId: string }> },
) {
  try {
    const { serviceId } = await context.params;
    await authorizeService(request, serviceId, "operator");
    const parsed = replay.safeParse(await request.clone().json());
    if (!parsed.success)
      return Response.json({ error: "Invalid replay input" }, { status: 400 });
    const action = await requireManagementRouteAction({
      request,
      environment: parsed.data.environment,
      actionId: "payment.event.replay",
      actionRisk: "provider-write",
    });
    return apiCenterAdminRequest(
      `/api/v1/admin/payments/events/${encodeURIComponent(serviceId)}/replay`,
      {
        method: "POST",
        body: JSON.stringify({ ...parsed.data, actor: action.session.email }),
      },
    );
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "Event replay failed; retry using the original operation ID",
    );
  }
}
