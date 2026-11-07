import { authorizeProject } from "@/lib/server/organization-access";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    await authorizeProject(request, projectId, "observer");
    const query = new URL(request.url).searchParams;
    const serviceId = query.get("serviceId")?.trim();
    const environment = query.get("environment");
    if (!serviceId) return Response.json({ success: false, error: "Select a service." }, { status: 400 });
    if (environment !== "test" && environment !== "live") return Response.json({ success: false, error: "Environment must be test or live." }, { status: 400 });
    return apiCenterAdminRequest(
      `/api/v1/tenancy/projects/${encodeURIComponent(projectId)}/setup-status?serviceId=${encodeURIComponent(serviceId)}&environment=${environment}`,
    );
  } catch (error) {
    return managementRouteErrorResponse(error, "Project setup status could not be loaded.");
  }
}
