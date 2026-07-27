import { createManagementProxyGET } from "@/lib/server/management-proxy-route";

export const GET = createManagementProxyGET({
  upstreamPath: "/api/v1/admin/catalog/products",
  fallbackError: "Catalog products request failed.",
});
