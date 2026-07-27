import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { quotaIncreaseRequestInputSchema } from "@/lib/schemas";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

export async function POST(request: Request) {
  try {
    const { session } = await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "developer-portal.quota-increase.request",
    });

    const input = quotaIncreaseRequestInputSchema.parse(await request.json());

    return apiCenterAdminRequest("/api/v1/approvals/requests", {
      method: "POST",
      body: JSON.stringify({
        actionType: "quota.increase",
        targetEnvironment: "live",
        targetId: input.ownerTribeId,
        requestedBy: session.email,
        riskLevel: "medium",
        reason: input.reason,
        before: { ownerTribeId: input.ownerTribeId },
        after: {
          ownerTribeId: input.ownerTribeId,
          requestedMaxRequests: input.requestedMaxRequests,
        },
      }),
    });
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "Quota increase request failed.",
    );
  }
}
