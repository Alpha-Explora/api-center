import { getApiCenterAdminUrl } from "@/lib/server/api-center-admin";
import { createOperationPreview } from "@/lib/operation-preview";
import { smokeTestRequestSchema } from "@/lib/schemas";
import { requireManagementAction } from "@/lib/server/require-management-action";
import { requireManagementSession } from "@/lib/server/require-management-session";
import { platformAdministratorResponse } from "@/lib/server/organization-access";

const allowedRoutes = new Set([
  "GET gauth /health",
  "POST gauth /oauth/authorize",
  "GET geo /health",
  "POST geo /geofence/check",
  "POST geo /geocode",
  "POST geo /reverse-geocode",
  "GET payment /health",
  "POST payment /customers",
  "POST payment /products",
  "POST payment /prices",
  "POST payment /checkout/sessions",
  "POST payment /subscriptions",
  "GET email /health",
  "POST email /send",
  "GET sms /health",
  "POST sms /send",
  "GET otp /health",
  "POST otp /generate",
  "POST otp /verify",
]);

const allowedRoutePatterns = [
  /^GET payment \/subscriptions\/[^/]+$/,
  /^POST payment \/subscriptions\/[^/]+\/cancel$/,
];

export async function POST(request: Request) {
  const denied = await platformAdministratorResponse(request);
  if (denied) return denied;
  const body = await request.json();

  if (isPreviewRequest(body)) {
    const environment = readRuntimeEnvironment((body as { environment?: unknown }).environment);

    return Response.json({
      preview: createOperationPreview({
        actionId: body.operation ?? "payment.subscription.rollout",
        environment,
        risk: "provider-write",
        changes: [
          "Create or validate checkout session wrapper",
          "Create or validate subscription wrapper",
          "Confirm webhook persistence path",
        ],
      }),
    });
  }

  const session = await requireManagementSession({
    authorizationHeader: request.headers.get("authorization"),
  });
  await requireManagementAction({
    session,
    environment: readRuntimeEnvironment((body as { environment?: unknown }).environment),
    actionRisk: "provider-write",
    actionId: "shared-service.smoke-test",
    typedPhrase: body.confirmation?.typedPhrase,
    reason: body.confirmation?.reason,
  });

  const input = smokeTestRequestSchema.parse(body);
  const routePath = normalizeRoutePath(input.path);
  const routeKey = `${input.method} ${input.serviceId} ${routePath}`;

  if (!allowedRoutes.has(routeKey) && !allowedRoutePatterns.some((pattern) => pattern.test(routeKey))) {
    return Response.json(
      {
        success: false,
        error: `Smoke-test route is not allowlisted: ${routeKey}`,
      },
      { status: 400 },
    );
  }

  const url = getApiCenterAdminUrl(
    `/api/v1/shared/${input.serviceId}${routePath}`,
  );
  const startedAt = performance.now();

  try {
    const response = await fetch(url, {
      method: input.method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.bearerToken}`,
      },
      body:
        input.method === "GET" || typeof input.body === "undefined"
          ? undefined
          : JSON.stringify(input.body),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
    const responseBody = await response.text();

    return Response.json({
      serviceId: input.serviceId,
      path: routePath,
      method: input.method,
      url,
      ok: response.ok,
      status: response.status,
      latencyMs: Math.round(performance.now() - startedAt),
      responsePreview: responseBody.slice(0, 1200),
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({
      serviceId: input.serviceId,
      path: routePath,
      method: input.method,
      url,
      ok: false,
      latencyMs: Math.round(performance.now() - startedAt),
      responsePreview:
        error instanceof Error ? error.message : "Smoke-test request failed.",
      checkedAt: new Date().toISOString(),
    });
  }
}

function isPreviewRequest(body: unknown): body is { preview: true; operation?: string } {
  return Boolean(
    body &&
      typeof body === "object" &&
      "preview" in body &&
      (body as { preview?: unknown }).preview === true,
  );
}

function normalizeRoutePath(path: string) {
  const trimmed = path.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function readRuntimeEnvironment(value: unknown): "test" | "live" {
  return value === "live" ? "live" : "test";
}
