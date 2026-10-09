import { createManagementProxyGET } from "@/lib/server/management-proxy-route";

export const GET = createManagementProxyGET({
  upstreamPath: "/api/v1/registry/services",
  organizationScoped: true,
  fallbackError: "Registry services request failed.",
});
