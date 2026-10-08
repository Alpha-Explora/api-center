import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createTribeInputSchema } from "@/lib/schemas";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { createManagementProxyGET } from "@/lib/server/management-proxy-route";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

export const GET = createManagementProxyGET({
  upstreamPath: "/api/v1/tenancy/tribes",
  fallbackError: "Tribe list request failed.",
});

export async function POST(request: Request) {
  try {
    await requireManagementRouteAction({
      request,
      actionRisk: "state-write",
      actionId: "tenancy.tribes.create",
    });
    const input = createTribeInputSchema.parse(await request.json());
    return apiCenterAdminRequest("/api/v1/tenancy/tribes", {
      method: "POST",
      body: JSON.stringify(input),
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
