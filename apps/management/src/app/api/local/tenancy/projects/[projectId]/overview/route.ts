import { authorizeProject, managementOrganizationFilter } from "@/lib/server/organization-access";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await context.params;
    await authorizeProject(request, projectId, "observer");
    const organizationId = await managementOrganizationFilter(request);
    const query = organizationId
      ? `?organizationId=${encodeURIComponent(organizationId)}`
      : "";
    return apiCenterAdminRequest(
      `/api/v1/tenancy/projects/${encodeURIComponent(projectId)}/overview${query}`,
    );
  } catch (error) {
    return managementRouteErrorResponse(error, "Project overview could not be loaded.");
  }
}
