import { GoogleAuth } from "google-auth-library";

const auth = new GoogleAuth();
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

type HeaderValue = string | string[] | number | undefined;
type HeaderRecord = Record<string, HeaderValue>;

export function shouldUseCloudRunAuth(upstream: string): boolean {
  if (process.env.CLOUD_RUN_AUTH_ENABLED !== "true") return false;

  try {
    const url = new URL(upstream);
    return url.protocol === "https:" && url.hostname.endsWith(".run.app");
  } catch {
    return false;
  }
}

export function buildCloudRunAudience(upstream: string): string {
  const url = new URL(upstream);
  return `${url.protocol}//${url.host}`;
}

export async function getCloudRunAuthorizationHeader(
  upstream: string,
): Promise<string | undefined> {
  if (!shouldUseCloudRunAuth(upstream)) return undefined;

  const audience = buildCloudRunAudience(upstream);
  const cached = tokenCache.get(audience);
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) {
    return `Bearer ${cached.token}`;
  }

  const client = await auth.getIdTokenClient(audience);
  const headers = await client.getRequestHeaders(audience);
  const raw = readAuthorizationHeader(headers);
  if (!raw) return undefined;

  const token = raw.replace(/^Bearer\s+/i, "");
  tokenCache.set(audience, {
    token,
    expiresAt: now + 45 * 60 * 1000,
  });

  return `Bearer ${token}`;
}

export function clearCloudRunAuthCacheForTesting(): void {
  tokenCache.clear();
}

function readAuthorizationHeader(headers: unknown): string | undefined {
  if (!headers) return undefined;

  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return (
      headers.get("authorization") ?? headers.get("Authorization") ?? undefined
    );
  }

  const record = headers as HeaderRecord;
  const value = record.Authorization ?? record.authorization;
  if (Array.isArray(value)) {
    return value[0];
  }

  return value === undefined ? undefined : String(value);
}
