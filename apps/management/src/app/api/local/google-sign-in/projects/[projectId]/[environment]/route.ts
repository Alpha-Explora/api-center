import { authorizeProject } from "@/lib/server/organization-access";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";

type Context = { params: Promise<{ projectId: string; environment: string }> };
type Method = "GET" | "PUT" | "DELETE";

async function forward(request: Request, context: Context, method: Method) {
  try {
    const { projectId, environment } = await context.params;
    if (environment !== "test" && environment !== "live") {
      return Response.json({ success: false, error: "Environment must be test or live." }, { status: 400 });
    }
    await authorizeProject(request, projectId, method === "GET" ? "observer" : "operator");
    return apiCenterAdminRequest(
      `/api/v1/admin/projects/${encodeURIComponent(projectId)}/google-sign-in/${environment}`,
      method === "PUT" ? { method, body: await request.text() } : { method },
    );
  } catch (error) {
    return managementRouteErrorResponse(error, "Google sign-in settings request failed.");
  }
}

export const GET = (request: Request, context: Context) => forward(request, context, "GET");
export const PUT = (request: Request, context: Context) => forward(request, context, "PUT");
export const DELETE = (request: Request, context: Context) => forward(request, context, "DELETE");
