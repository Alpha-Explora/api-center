import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { serviceTokenRequestSchema } from "@/lib/schemas";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

export async function POST(request: Request) {
  await requireManagementRouteAction({
    request,
    actionRisk: "low-write",
    actionId: "auth.token.issue",
  });

  const body = await request.json();
  const input = serviceTokenRequestSchema.parse(body);

  return apiCenterAdminRequest("/api/v1/auth/token", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
