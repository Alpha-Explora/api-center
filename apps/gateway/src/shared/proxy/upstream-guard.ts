// Guards upstream URLs that tenants control (published APIs) against server-side request forgery:
// HTTPS only, no credentials in the URL, and every resolved address must be publicly routable.
// The check runs at registration and again before each forward, because DNS can change.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { AppError } from "../errors";

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata", "instance-data"]);

export type AddressResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: AddressResolver = async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const value = address.toLowerCase();
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(value) || value.startsWith("64:ff9b:") || value.startsWith("2001:db8:");
}

function reject(message: string): never {
  throw new AppError(message, 400, "UPSTREAM_NOT_ALLOWED");
}

/** Validates the URL shape: https (http only when explicitly allowed), no userinfo, no blocked host. */
export function assertUpstreamUrlShape(raw: string, options: { allowHttp?: boolean; allowPrivateForTesting?: boolean } = {}): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    reject("Upstream URL is not a valid URL");
  }
  if (url.protocol !== "https:" && !(options.allowHttp && url.protocol === "http:")) reject("Upstream URL must use https");
  if (url.username || url.password) reject("Upstream URL must not contain credentials");
  if (options.allowPrivateForTesting) return url;
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".internal") || hostname.endsWith(".local")) {
    reject("Upstream host is not allowed");
  }
  if (isIP(hostname) && isPrivateAddress(hostname)) reject("Upstream address is not publicly routable");
  return url;
}

/** Resolves the host and rejects private, loopback, link-local and metadata addresses. */
export async function assertPublicUpstream(
  raw: string,
  options: { allowHttp?: boolean; resolve?: AddressResolver; allowPrivateForTesting?: boolean } = {},
): Promise<URL> {
  const url = assertUpstreamUrlShape(raw, options);
  if (options.allowPrivateForTesting) return url;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: string[];
  try {
    addresses = isIP(hostname) ? [hostname] : await (options.resolve ?? defaultResolver)(hostname);
  } catch {
    reject("Upstream host does not resolve");
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) reject("Upstream address is not publicly routable");
  return url;
}

/** Local development may opt into http and private upstreams; never in production. */
export function upstreamGuardOptions(env: NodeJS.ProcessEnv = process.env) {
  const local = env.NODE_ENV !== "production" && env.CONTROL_PLANE_ALLOW_PRIVATE_UPSTREAMS === "true";
  return { allowHttp: local, allowPrivateForTesting: local };
}
