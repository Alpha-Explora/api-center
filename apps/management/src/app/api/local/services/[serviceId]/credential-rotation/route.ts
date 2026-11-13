import { z } from "zod";
import { authorizeService } from "@/lib/server/organization-access";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";

const inputSchema = z.object({
  environment: z.enum(["test", "live"]),
  operationId: z.string().uuid(),
  action: z.enum(["start", "verify", "revoke-old"]),
  secretHashSha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  reason: z.string().trim().min(1).max(500),
});
export async function POST(
  request: Request,
  context: { params: Promise<{ serviceId: string }> },
) {
  try {
    const { serviceId } = await context.params;
    await authorizeService(request, serviceId, "operator");
    const parsed = inputSchema.safeParse(await request.clone().json());
    if (!parsed.success)
      return Response.json(
        { error: "Invalid credential lifecycle request" },
        { status: 400 },
      );
    const action = await requireManagementRouteAction({
      request,
      environment: parsed.data.environment,
      actionRisk: "provider-write",
      actionId: `service.credential.${parsed.data.action}`,
    });
    return apiCenterAdminRequest(
      "/api/v1/admin/registry/service-credentials/rotation",
      {
        method: "POST",
        body: JSON.stringify({
          ...parsed.data,
          serviceId,
          actor: action.session.email,
        }),
      },
    );
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "Credential rotation failed; inspect the current state before retrying",
    );
  }
}
