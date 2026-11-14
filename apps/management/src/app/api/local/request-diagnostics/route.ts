import { z } from "zod";
import { requirePlatformAdministrator } from "@/lib/server/organization-access";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
export async function GET(request: Request) {
  try {
    await requirePlatformAdministrator(request);
    const correlation = z
      .string()
      .regex(/^[a-zA-Z0-9._:-]{1,128}$/)
      .safeParse(new URL(request.url).searchParams.get("correlationId"));
    if (!correlation.success)
      return Response.json(
        { error: "A valid correlation ID is required" },
        { status: 400 },
      );
    const query = new URLSearchParams({
      environment: "unattributed",
      correlationId: correlation.data,
      from: new Date(Date.now() - 86_400_000).toISOString(),
      to: new Date().toISOString(),
      limit: "50",
    });
    return apiCenterAdminRequest(`/api/v1/admin/operations/requests?${query}`);
  } catch (error) {
    return managementRouteErrorResponse(
      error,
      "Platform administrator access is required to inspect unattributed requests",
    );
  }
}
