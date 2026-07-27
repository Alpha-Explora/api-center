import {
  apiCenterAdminJson,
  getApiCenterAdminUrl,
} from "@/lib/server/api-center-admin";
import {
  contractTestRequestSchema,
  registryDetailResponseSchema,
  type ContractTestResult,
} from "@/lib/schemas";
import { requireManagementRouteAction } from "@/lib/server/require-management-action";

export async function POST(request: Request) {
  await requireManagementRouteAction({
    request,
    actionRisk: "low-write",
    actionId: "contract.test",
  });

  const body = await request.json();
  const input = contractTestRequestSchema.parse(body);
  const detail = await apiCenterAdminJson<unknown>(
    `/api/v1/registry/services/${encodeURIComponent(input.serviceId)}`,
  );
  const service = registryDetailResponseSchema.parse(detail).data;
  const routeNamespace = service.serviceType === "shared" ? "shared" : "tribes";
  const routePath = normalizeRoutePath(input.path);
  const directUrl = joinUrl(service.baseUrl, routePath);
  const proxyUrl = getApiCenterAdminUrl(
    `/api/v1/${routeNamespace}/${service.serviceId}${routePath}`,
  );

  const attempts: ContractTestResult["attempts"] = [
    await attemptFetch("direct", directUrl, input.method),
  ];

  if (input.bearerToken) {
    attempts.push(
      await attemptFetch("api-center-proxy", proxyUrl, input.method, {
        authorization: `Bearer ${input.bearerToken}`,
      }),
    );
  } else {
    attempts.push({
      mode: "api-center-proxy" as const,
      url: proxyUrl,
      ok: false,
      skipped: true,
      error:
        "Skipped because no bearer token was provided. The console does not store tribe credentials.",
    });
  }

  return Response.json({
    serviceId: service.serviceId,
    checkedAt: new Date().toISOString(),
    routeNamespace,
    attempts,
  });
}

function normalizeRoutePath(path: string) {
  const trimmed = path.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

async function attemptFetch(
  mode: "direct" | "api-center-proxy",
  url: string,
  method: string,
  headers?: HeadersInit,
) {
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      method,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.text();

    return {
      mode,
      url,
      ok: response.ok,
      status: response.status,
      latencyMs: Math.round(performance.now() - startedAt),
      responsePreview: body.slice(0, 500),
    };
  } catch (error) {
    return {
      mode,
      url,
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : "Request failed.",
    };
  }
}
