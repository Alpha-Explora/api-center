import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";

type RouteContext = { params: Promise<{ id: string; action: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id, action } = await context.params;
  if (!["approve", "reject", "revoke"].includes(action)) {
    return Response.json(
      { success: false, error: "Invalid subscription action" },
      { status: 400 },
    );
  }
  return apiCenterAdminRequest(
    `/api/v1/admin/api-subscriptions/${encodeURIComponent(id)}/${action}`,
    { method: "PATCH", body: await request.text() },
  );
}
