let managementSessionToken: string | undefined;
let onSessionRejected: (() => void) | undefined;

export function setManagementSessionToken(token: string | undefined) {
  managementSessionToken = token;
}

/** Called when the console server answers 401 to a signed-in request: the Google token expired or was revoked. */
export function setSessionRejectedHandler(handler: (() => void) | undefined) {
  onSessionRejected = handler;
}

export async function localApiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  // The token this request is sent with. The current one may change before the response arrives.
  const sentToken = managementSessionToken;
  let response: Response;
  try {
    response = await fetch(resolveFetchUrl(path), {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(sentToken ? { authorization: `Bearer ${sentToken}` } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError("The console could not reach APICenter. Check your connection.", 0, "NETWORK_ERROR");
  }

  if (!response.ok) {
    const body = await response.text();
    // Only a rejection of the token still in use ends the session. A request sent before sign-in
    // finished, or with a token since replaced, says nothing about the current one.
    if (response.status === 401 && sentToken && sentToken === managementSessionToken && path.startsWith("/api/")) onSessionRejected?.();
    throw new ApiError(formatRequestError(response.status, body), response.status, errorCode(body), retryAfter(response));
  }

  return response.json() as Promise<T>;
}

export const request = localApiRequest;

/** A failed console or gateway call: the readable message plus the HTTP status and gateway error code. */
export class ApiError extends Error {
  constructor(
    message: string,
    /** 0 when the request never got a response. */
    readonly status: number,
    readonly code?: string,
    /** From the response's Retry-After header, when it sent one in seconds. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function retryAfter(response: Response): number | undefined {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value >= 0 && response.headers.has("retry-after") ? value : undefined;
}

function errorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: { code?: unknown } };
    return typeof parsed.error?.code === "string" ? parsed.error.code : undefined;
  } catch {
    return undefined;
  }
}

export function withQuery(path: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function getApiCenterBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_API_CENTER_BASE_URL ??
    "https://api.apicenter.itsandbox.site"
  ).replace(/\/$/, "");
}

function resolveFetchUrl(path: string) {
  if (!path.startsWith("/") || typeof window !== "undefined") {
    return path;
  }

  const baseUrl = process.env.MANAGEMENT_PUBLIC_BASE_URL ?? "http://localhost:3000";

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

  // A non-JSON body is usually an HTML error page from a proxy; it means nothing to the reader.
  return `Request failed with HTTP ${status}`;
}
