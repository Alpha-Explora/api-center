import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireOrganizationRole } from "@/lib/server/organization-access";

type Context = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const { organizationId } = await context.params;
    await requireOrganizationRole(request, organizationId, "admin");
    return apiCenterAdminRequest(`/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/members`);
  } catch (error) {
    return managementRouteErrorResponse(error, "Organization member list failed.");
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { organizationId } = await context.params;
    await requireOrganizationRole(request, organizationId, "admin");
    const { email, role } = await request.json();
    if (typeof email !== "string" || !email.trim() || !["admin", "operator", "observer"].includes(role)) {
      return Response.json({ success: false, error: "A valid email and organization role are required." }, { status: 400 });
    }
    return apiCenterAdminRequest(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(email.trim())}`,
      { method: "PUT", body: JSON.stringify({ role }) },
    );
  } catch (error) {
    return managementRouteErrorResponse(error, "Organization member update failed.");
  }
}
