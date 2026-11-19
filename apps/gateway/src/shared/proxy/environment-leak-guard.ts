// Callers cannot pick an environment: it comes from their key. Requests that try to are refused.
import { ForbiddenError } from "../errors";

export const ENVIRONMENT_OVERRIDE_HEADERS = [
  "x-apicenter-target-environment",
  "x-apicenter-environment",
  "x-target-environment",
];

export function assertNoEnvironmentOverrides(input: {
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
}): void {
  const headers = input.headers ?? {};
  for (const headerName of Object.keys(headers)) {
    if (ENVIRONMENT_OVERRIDE_HEADERS.includes(headerName.toLowerCase())) {
      throw new ForbiddenError("Environment override headers are not allowed");
    }
  }

  const query = input.query ?? {};
  if (hasEnvironmentOverrideKey(query)) {
    throw new ForbiddenError("Environment override query parameters are not allowed");
  }

  if (input.body && typeof input.body === "object" && hasEnvironmentOverrideKey(input.body as Record<string, unknown>)) {
    throw new ForbiddenError("Environment override body fields are not allowed");
  }
}

function hasEnvironmentOverrideKey(record: Record<string, unknown>): boolean {
  return [
    "environment",
    "targetEnvironment",
    "target_environment",
    "apicenterEnvironment",
    "apicenter_environment",
    "requestedEnvironment",
    "requested_environment",
  ].some((key) => Object.prototype.hasOwnProperty.call(record, key));
}