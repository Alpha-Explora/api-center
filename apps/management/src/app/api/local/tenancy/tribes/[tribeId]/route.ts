import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { updateTenancyStatusInputSchema } from "@/lib/schemas";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { createManagementProxyGET } from "@/lib/server/management-proxy-route";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { authorizeTribe } from "@/lib/server/organization-access";

type Context = { params: Promise<{ tribeId: string }> };

export const GET = createManagementProxyGET<Context>({
  upstreamPath: async (_request, context) => {
    const { tribeId } = (await context?.params) ?? { tribeId: "" };
    return `/api/v1/tenancy/tribes/${encodeURIComponent(tribeId)}`;
  },
  beforeRequest: async (request, context) => {
    const { tribeId } = (await context?.params) ?? { tribeId: "" };
    await authorizeTribe(request, tribeId);
  },
  fallbackError: "Tribe request failed.",
});

export async function PATCH(request: Request, context: Context) {
  try {
    const { tribeId } = await context.params;
    await authorizeTribe(request, tribeId, "admin");
    await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "tenancy.tribes.update",
    });
    const input = updateTenancyStatusInputSchema.parse(await request.json());
    return apiCenterAdminRequest(`/api/v1/tenancy/tribes/${encodeURIComponent(tribeId)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }
    return managementRouteErrorResponse(error, "Tribe update failed.");
  }
}
