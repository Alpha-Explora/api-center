import { createManagementProxyGET } from "@/lib/server/management-proxy-route";

export const GET = createManagementProxyGET({
  upstreamPath: "/api/v1/plans/definitions",
  fallbackError: "Plan definitions request failed.",
});
