import { getDeploymentConfigCheck } from "@/lib/server/deployment-config";
import { platformAdministratorResponse } from "@/lib/server/organization-access";

export async function GET(request: Request) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  return Response.json({
    checkedAt: new Date().toISOString(),
    data: getDeploymentConfigCheck(),
  });
}
