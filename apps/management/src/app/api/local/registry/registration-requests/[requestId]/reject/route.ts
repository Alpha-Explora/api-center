import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

type Context = {
  params: Promise<{ requestId: string }>;
};

export async function POST(request: Request, context: Context) {
  const { requestId } = await context.params;
  await requireManagementRouteAction({
    request,
    actionRisk: "state-write",
    actionId: "registry.registration-request.reject",
  });

  return apiCenterAdminRequest(
    `/api/v1/registry/registration-requests/${encodeURIComponent(requestId)}/reject`,
    {
      method: "POST",
      body: await request.text(),
    },
  );
}
