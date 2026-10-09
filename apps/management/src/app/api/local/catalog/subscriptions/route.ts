import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const consumerProjectId = searchParams.get("consumerProjectId");
  const apiServiceId = searchParams.get("apiServiceId");
  const query = new URLSearchParams();
  if (consumerProjectId) query.set("consumerProjectId", consumerProjectId);
  if (apiServiceId) query.set("apiServiceId", apiServiceId);
  return apiCenterAdminRequest(`/api/v1/admin/api-subscriptions?${query}`);
}

export async function POST(request: Request) {
  const body = await request.text();
  return apiCenterAdminRequest("/api/v1/admin/api-subscriptions", {
    method: "POST",
    body,
  });
}
