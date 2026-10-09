import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireOrganizationRole } from "@/lib/server/organization-access";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ organizationId: string; email: string }> },
) {
  try {
    const { organizationId, email } = await context.params;
    await requireOrganizationRole(request, organizationId, "admin");
    return apiCenterAdminRequest(
      `/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(email)}`,
      { method: "DELETE" },
    );
  } catch (error) {
    return managementRouteErrorResponse(error, "Organization member removal failed.");
  }
}
