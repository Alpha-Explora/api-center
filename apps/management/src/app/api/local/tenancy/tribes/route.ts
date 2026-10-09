import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createTribeInputSchema } from "@/lib/schemas";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { createManagementProxyGET } from "@/lib/server/management-proxy-route";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { requireManagementSession } from "@/lib/server/require-management-session";
import { requireOrganizationRole } from "@/lib/server/organization-access";

export const GET = createManagementProxyGET({
  upstreamPath: "/api/v1/tenancy/tribes",
  organizationScoped: true,
  fallbackError: "Tribe list request failed.",
});

export async function POST(request: Request) {
  try {
    const session = await requireManagementSession({
      authorizationHeader: request.headers.get("authorization"),
    });
    const input = createTribeInputSchema.parse(await request.json());
    const organizationId = input.organizationId ?? (session.organizationIds.length === 1 ? session.organizationIds[0] : undefined);
    if (!session.platformAdmin && !organizationId) {
      throw new Error("Organization access denied: choose an organization before creating a tribe");
    }
    if (organizationId) await requireOrganizationRole(request, organizationId, "admin");
    await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "tenancy.tribes.create",
    });
    return apiCenterAdminRequest("/api/v1/tenancy/tribes", {
      method: "POST",
      body: JSON.stringify({ ...input, ...(organizationId ? { organizationId } : {}) }),
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }
    return managementRouteErrorResponse(error, "Tribe creation failed.");
  }
}
