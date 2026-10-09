import { NextResponse } from "next/server";

import { quotaUsageWindowSchema } from "@/lib/schemas";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import {
  authorizeTribe,
  requirePlatformAdministrator,
} from "@/lib/server/organization-access";
import { requireManagementSession } from "@/lib/server/require-management-session";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const params = new URLSearchParams();
    const ownerTribeId = url.searchParams.get("ownerTribeId");
    const window = url.searchParams.get("window") ?? "24h";

    const session = await requireManagementSession({
      authorizationHeader: request.headers.get("authorization"),
    });
    if (!session.platformAdmin && !ownerTribeId) {
      return NextResponse.json(
        { success: false, error: "ownerTribeId is required." },
        { status: 400 },
      );
    }
    if (ownerTribeId) await authorizeTribe(request, ownerTribeId, "observer");
    else await requirePlatformAdministrator(request);

    const windowResult = quotaUsageWindowSchema.safeParse(window);
    if (!windowResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: "window must be one of: 1h, 24h, 7d, 30d",
        },
        { status: 400 },
      );
    }

    if (ownerTribeId) params.set("ownerTribeId", ownerTribeId);
    params.set("window", windowResult.data);

    return apiCenterAdminRequest(`/api/v1/quotas/usage?${params.toString()}`);
  } catch (error) {
    return managementRouteErrorResponse(error, "Quota usage access denied.");
  }
}
