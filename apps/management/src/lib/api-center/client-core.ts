let managementSessionToken: string | undefined;

export function setManagementSessionToken(token: string | undefined) {
  managementSessionToken = token;
}

export async function localApiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(resolveFetchUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(managementSessionToken
        ? { authorization: `Bearer ${managementSessionToken}` }
        : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(formatRequestError(response.status, body));
  }

  return response.json() as Promise<T>;
}

export const request = localApiRequest;

export function withQuery(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function getApiCenterBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_API_CENTER_BASE_URL ??
    "https://api-center.itsandbox.site"
  ).replace(/\/$/, "");
}

function resolveFetchUrl(path: string) {
  if (!path.startsWith("/") || typeof window !== "undefined") {
    return path;
  }

  const baseUrl =
    process.env.MANAGEMENT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

  return new URL(path, baseUrl).toString();
}

function formatRequestError(status: number, body: string) {
  if (!body) {
    return `Request failed with HTTP ${status}`;
  }

  try {
    const parsed = JSON.parse(body) as {
      error?: unknown;
      message?: unknown;
    };
    const nestedMessage =
      typeof parsed.error === "object" &&
      parsed.error !== null &&
      "message" in parsed.error
        ? (parsed.error as { message?: unknown }).message
        : undefined;
    for (const message of [nestedMessage, parsed.error, parsed.message]) {
      if (typeof message === "string" && message.trim()) {
        return message;
      }
    }
  } catch {
    // Fall through to the raw response preview.
  }

  return `Request failed with HTTP ${status}: ${body}`;
}
