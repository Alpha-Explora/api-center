import { createManagementProxyGET } from "@/lib/server/management-proxy-route";

export const GET = createManagementProxyGET({
  actionRisk: "read",
  actionId: "compliance.export.read",
  platformAdminOnly: true,
  upstreamPath: "/api/v1/admin/compliance/export",
  queryParams: ["from", "to", "format"],
  fallbackError: "Compliance export failed.",
});
