import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { quotaPolicyInputSchema } from "@/lib/quota-policy";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { createManagementProxyGET } from "@/lib/server/management-proxy-route";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

export const GET = createManagementProxyGET({
  upstreamPath: "/api/v1/quotas/policies",
  queryParams: ["ownerTribeId"],
  fallbackError: "Quota policy request failed.",
});

export async function POST(request: Request) {
  try {
    await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "quotas.policies.create",
    });

    const body = await request.json();
    const input = quotaPolicyInputSchema.parse(body);

    return apiCenterAdminRequest("/api/v1/quotas/policies", {
      method: "POST",
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: error.issues[0]?.message ?? "Invalid request.",
        },
        { status: 400 },
      );
    }

    return managementRouteErrorResponse(error, "Quota policy request failed.");
  }
}
