export function getApiCenterAdminConfig() {
  const platformSecret = getPlatformSecret();

  return {
    apiCenterBaseUrl: getApiCenterBaseUrl(),
    hasApiCenterBaseUrl: Boolean(process.env.API_CENTER_BASE_URL),
    hasPlatformSecret: Boolean(platformSecret),
    exposesPlatformSecretToBrowser: Boolean(
      process.env.NEXT_PUBLIC_API_CENTER_PLATFORM_ADMIN_SECRET,
    ),
    publicApiCenterBaseUrl:
      process.env.NEXT_PUBLIC_API_CENTER_BASE_URL ??
      "https://api-center.itsandbox.site",
  };
}

type ApiCenterAdminRequestInit = RequestInit & {
  timeoutMs?: number;
};

export async function apiCenterAdminRequest(
  path: string,
  init?: ApiCenterAdminRequestInit,
) {
  const apiCenterBaseUrl = getApiCenterBaseUrl();
  const platformSecret = getPlatformSecret();
  const { timeoutMs = 8_000, ...fetchInit } = init ?? {};

  if (!platformSecret) {
    return Response.json(
      {
        success: false,
        error:
          "API_CENTER_PLATFORM_ADMIN_SECRET is missing. Set it as a server environment variable for this management deployment.",
        meta: buildUnavailableSourceMeta(
          path,
          "API_CENTER_PLATFORM_ADMIN_SECRET is missing.",
        ),
      },
      { status: 500 },
    );
  }

  let response: Response;

  try {
    response = await fetch(`${apiCenterBaseUrl}${path}`, {
      ...fetchInit,
      headers: {
        "content-type": "application/json",
        "x-platform-secret": platformSecret,
        ...(fetchInit.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "API Center request timed out.";
    return Response.json(
      {
        success: false,
        error: reason,
        meta: buildUnavailableSourceMeta(path, reason),
      },
      { status: 504 },
    );
  }

  const body = await response.text();

  if (!response.ok) {
    return withFallbackSourceMetadata(path, response, body);
  }

  return new Response(body, {
    status: response.status,
    headers: {
      "content-type":
        response.headers.get("content-type") ?? "application/json",
    },
  });
}

function withFallbackSourceMetadata(
  path: string,
  response: Response,
  body: string,
) {
  const contentType =
    response.headers.get("content-type") ?? "application/json";
  const parsed = parseJsonObject(body);
  if (parsed && hasSourceMetadata(parsed)) {
    return new Response(body, {
      status: response.status,
      headers: { "content-type": contentType },
    });
  }

  const reason =
    parsed && typeof parsed.error === "string"
      ? parsed.error
      : body || `API Center returned ${response.status}.`;

  return Response.json(
    {
      ...(parsed ?? { success: false, error: reason }),
      meta: buildUnavailableSourceMeta(path, reason),
    },
    { status: response.status },
  );
}

function parseJsonObject(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasSourceMetadata(parsed: Record<string, unknown>) {
  const meta = parsed.meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return false;
  const sourceMetadata = (meta as { sourceMetadata?: unknown }).sourceMetadata;
  return Array.isArray(sourceMetadata) && sourceMetadata.length > 0;
}

export async function apiCenterAdminJson<T>(path: string, init?: RequestInit) {
  const apiCenterBaseUrl = getApiCenterBaseUrl();
  const platformSecret = getPlatformSecret();

  if (!platformSecret) {
    throw new Error(
      "API_CENTER_PLATFORM_ADMIN_SECRET is missing. Set it as a server environment variable for this management deployment.",
    );
  }

  const response = await fetch(`${apiCenterBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-platform-secret": platformSecret,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`API Center returned ${response.status}: ${body}`);
  }

  return JSON.parse(body) as T;
}

export function getApiCenterAdminUrl(path: string) {
  return `${getApiCenterBaseUrl()}${path}`;
}

function getApiCenterBaseUrl() {
  return (
    process.env.API_CENTER_BASE_URL ?? "https://api-center.itsandbox.site"
  ).replace(/\/$/, "");
}

function getPlatformSecret() {
  return process.env.API_CENTER_PLATFORM_ADMIN_SECRET;
}

function buildUnavailableSourceMeta(path: string, reason: string) {
  return {
    timestamp: new Date().toISOString(),
    sourceMetadata: unavailableSourcesForPath(path).map((sourceName) => ({
      sourceType: "unavailable" as const,
      sourceName,
      durability: "none" as const,
      degradedReason: reason,
    })),
  };
}

function unavailableSourcesForPath(path: string) {
  if (path.includes("/analytics/gateway-traffic")) {
    return ["gateway-traffic-api-center"];
  }
  if (path.includes("/analytics/shared-service-usage")) {
    return ["shared-service-usage-api-center"];
  }
  if (path.includes("/analytics/audit/events")) {
    return ["audit-events-api-center"];
  }
  if (path.includes("/compliance/export")) {
    return ["audit-events-api-center", "promotion-evidence-api-center"];
  }
  if (path.includes("/operations/evidence")) {
    return ["promotion-evidence-api-center", "audit-evidence-api-center"];
  }
  return ["api-center-admin-proxy"];
}
