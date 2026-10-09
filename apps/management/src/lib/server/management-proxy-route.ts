import type { ActionRisk } from "@/lib/action-policy";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { allowQueryParams, querySuffix } from "@/lib/server/query-params";
import { managementOrganizationFilter, requirePlatformAdministrator } from "@/lib/server/organization-access";

type EmptyRouteContext = {
  params: Promise<Record<string, never>>;
};

type ManagementProxyGETOptions<TContext = EmptyRouteContext> = {
  actionId?: string;
  actionRisk?: ActionRisk;
  upstreamPath:
    | string
    | ((request: Request, context: TContext | undefined) => Promise<string> | string);
  queryParams?: string[];
  fallbackError: string;
  /** Appends the authenticated user's organization set to a gateway-owned collection read. */
  organizationScoped?: boolean;
  beforeRequest?: (request: Request, context: TContext | undefined) => Promise<void>;
  platformAdminOnly?: boolean;
};

export function createManagementProxyGET<TContext = EmptyRouteContext>(
  options: ManagementProxyGETOptions<TContext>,
) {
  return async function GET(
    request: Request = new Request("http://localhost"),
    context?: TContext,
  ) {
    try {
      if (options.actionId && options.actionRisk) {
        await requireManagementRouteAction({
          request,
          actionRisk: options.actionRisk,
          actionId: options.actionId,
        });
      }

      const upstreamPath =
        typeof options.upstreamPath === "function"
          ? await options.upstreamPath(request, context)
          : options.upstreamPath;
      if (options.platformAdminOnly) await requirePlatformAdministrator(request);
      await options.beforeRequest?.(request, context);
      const suffix = options.queryParams
        ? querySuffix(allowQueryParams(request, options.queryParams))
        : "";
      const organizationId = options.organizationScoped
        ? await managementOrganizationFilter(request)
        : undefined;
      const scopedSuffix = organizationId
        ? `${suffix ? `${suffix}&` : "?"}organizationId=${encodeURIComponent(organizationId)}`
        : suffix;

      return apiCenterAdminRequest(`${upstreamPath}${scopedSuffix}`);
    } catch (error) {
      return managementRouteErrorResponse(error, options.fallbackError);
    }
  };
}
