import { z } from "zod";
import { authorizeService } from "@/lib/server/organization-access";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";

const inputSchema = z.object({ environment: z.enum(["test", "live"]), keyId: z.string().uuid() });
export async function POST(request: Request, context: { params: Promise<{ serviceId: string }> }) {
  try {
    const { serviceId } = await context.params;
    await authorizeService(request, serviceId, "operator");
    const input = inputSchema.safeParse(await request.clone().json());
    if (!input.success) return Response.json({ error: "Invalid key revocation" }, { status: 400 });
    await requireManagementRouteAction({ request, environment: input.data.environment, actionRisk: "provider-write", actionId: "payment.consumer.revoke-key" });
    return apiCenterAdminRequest(`/api/v1/admin/payments/consumers/${encodeURIComponent(serviceId)}/keys/revoke`, { method: "POST", body: JSON.stringify(input.data) });
  } catch (error) { return managementRouteErrorResponse(error, "Key revocation failed"); }
}
