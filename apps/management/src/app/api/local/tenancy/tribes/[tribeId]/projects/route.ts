import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createProjectInputSchema } from "@/lib/schemas";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { authorizeTribe } from "@/lib/server/organization-access";

export async function POST(
  request: Request,
  context: { params: Promise<{ tribeId: string }> },
) {
  try {
    const { tribeId } = await context.params;
    await authorizeTribe(request, tribeId, "admin");
    await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "tenancy.projects.create",
    });
    const input = createProjectInputSchema.parse(await request.json());
    return apiCenterAdminRequest(
      `/api/v1/tenancy/tribes/${encodeURIComponent(tribeId)}/projects`,
      { method: "POST", body: JSON.stringify(input) },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      );
    }
    return managementRouteErrorResponse(error, "Project creation failed.");
  }
}
