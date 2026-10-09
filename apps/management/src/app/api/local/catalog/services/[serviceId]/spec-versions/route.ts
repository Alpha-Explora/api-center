import { createManagementProxyGET } from "@/lib/server/management-proxy-route";

type RouteContext = { params: Promise<{ serviceId: string }> };

export const GET = createManagementProxyGET<RouteContext>({
  upstreamPath: async (_request, context) => {
    const { serviceId } = await context!.params;
    return `/api/v1/admin/catalog/services/${encodeURIComponent(serviceId)}/spec-versions`;
  },
  fallbackError: "Service specification versions request failed.",
});
