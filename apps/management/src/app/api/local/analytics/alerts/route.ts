import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const window = url.searchParams.get("window") ?? "1h";

  return apiCenterAdminRequest(
    `/api/v1/analytics/alerts?window=${encodeURIComponent(window)}`,
  );
}

