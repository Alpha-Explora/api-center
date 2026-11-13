// Forwards an authorized control-plane request upstream with only the signed context and an
// allowlisted set of headers. The caller's own credentials never leave the gateway.

import type { Response } from "express";
import { AppError, BadGatewayError } from "../errors";
import { getCloudRunAuthorizationHeader } from "./cloud-run-auth";
import type { AuthenticatedRequest } from "../../types";

export const FORWARDED_REQUEST_HEADERS = ["idempotency-key", "accept"];
export const RETURNED_RESPONSE_HEADERS = ["content-type", "x-idempotency-replayed", "retry-after"];

export type FetchLike = (url: string, init: RequestInit) => Promise<globalThis.Response>;
export type CloudRunAuthorizer = (upstream: string) => Promise<string | undefined>;

export interface SignedForwardInput {
  req: AuthenticatedRequest;
  res: Response;
  targetBaseUrl: string;
  relativePath: string;
  signedContext: string;
  requestId: string;
  label: string;
  fetchImpl: FetchLike;
  cloudRunAuthorizer: CloudRunAuthorizer;
  timeoutMs: number;
}

/** Returns the upstream status after writing the response. */
export async function forwardSigned(input: SignedForwardInput): Promise<number> {
  const { req, res } = input;
  const headers: Record<string, string> = {
    "X-APICenter-Context": input.signedContext,
    "X-APICenter-Correlation-Id": input.requestId,
    "X-Correlation-ID": input.requestId,
    "X-Forwarded-By": "apicenter-gateway",
  };
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers[name];
    if (typeof value === "string" && value) headers[name] = value;
  }
  const cloudRunAuthorization = await input.cloudRunAuthorizer(input.targetBaseUrl);
  if (cloudRunAuthorization) {
    headers.Authorization = cloudRunAuthorization;
    headers["X-Serverless-Authorization"] = cloudRunAuthorization;
  }

  const hasBody = !["GET", "HEAD"].includes(req.method.toUpperCase()) && req.body !== undefined;
  if (hasBody) headers["Content-Type"] = "application/json";
  const query = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  const target = `${input.targetBaseUrl.replace(/\/$/, "")}${input.relativePath}${query}`;

  let upstream: globalThis.Response;
  try {
    upstream = await input.fetchImpl(target, {
      method: req.method,
      headers,
      ...(hasBody ? { body: JSON.stringify(req.body) } : {}),
      signal: AbortSignal.timeout(input.timeoutMs),
      redirect: "manual",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new AppError(`${input.label} did not respond in time`, 504, "UPSTREAM_TIMEOUT");
    }
    throw new BadGatewayError(`${input.label} is unreachable`);
  }

  res.status(upstream.status);
  for (const name of RETURNED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) res.setHeader(name, value);
  }
  res.setHeader("X-Correlation-ID", input.requestId);
  res.send(Buffer.from(await upstream.arrayBuffer()));
  return upstream.status;
}

/** `/api/v1/<namespace>/<id>/a/b` → `/a/b`. Rejects traversal and encoded separators. */
export function relativeUpstreamPath(requestPath: string, prefix: string): string {
  if (!requestPath.startsWith(`${prefix}/`)) {
    throw new AppError("Request path is invalid", 400, "INVALID_UPSTREAM_PATH");
  }
  const relative = requestPath.slice(prefix.length);
  const segments = relative.split("/").slice(1);
  if (segments.some((segment) => segment === "." || segment === ".." || /%2f|%5c|%2e/i.test(segment))) {
    throw new AppError("Request path is invalid", 400, "INVALID_UPSTREAM_PATH");
  }
  return relative;
}
