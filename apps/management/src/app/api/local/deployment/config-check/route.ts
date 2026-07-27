import { getDeploymentConfigCheck } from "@/lib/server/deployment-config";

export async function GET() {
  return Response.json({
    checkedAt: new Date().toISOString(),
    data: getDeploymentConfigCheck(),
  });
}
