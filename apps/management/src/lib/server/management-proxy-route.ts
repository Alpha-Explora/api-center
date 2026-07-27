import type { ActionRisk } from "@/lib/action-policy";
import { apiCenterAdminRequest } from "@/lib/server/api-center-admin";
import { managementRouteErrorResponse } from "@/lib/server/management-route-error";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";
import { allowQueryParams, querySuffix } from "@/lib/server/query-params";

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
      const suffix = options.queryParams
        ? querySuffix(allowQueryParams(request, options.queryParams))
        : "";

      return apiCenterAdminRequest(`${upstreamPath}${suffix}`);
    } catch (error) {
      return managementRouteErrorResponse(error, options.fallbackError);
    }
  };
}
