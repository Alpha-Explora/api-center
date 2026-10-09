import { createManagementProxyGET } from "@/lib/server/management-proxy-route";

export const GET = createManagementProxyGET({
  upstreamPath: "/api/v1/capabilities",
  platformAdminOnly: true,
  fallbackError: "Capabilities request failed.",
});
