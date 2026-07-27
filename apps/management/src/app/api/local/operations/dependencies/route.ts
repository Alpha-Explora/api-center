import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";

export async function GET() {
  return apiCenterAdminRequest("/api/v1/admin/operations/dependencies");
}
