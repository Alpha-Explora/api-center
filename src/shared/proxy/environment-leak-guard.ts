import { ForbiddenError, ServiceUnavailableError } from "../errors";
import {
  ApicenterRuntimeEnvironment,
  isApicenterRuntimeEnvironment,
  ServiceLifecycleStatus,
} from "../../types";

export const ENVIRONMENT_OVERRIDE_HEADERS = [
  "x-apicenter-target-environment",
  "x-apicenter-environment",
  "x-target-environment",
];

export function enforceEnvironmentAccess(input: {
  callerEnvironment?: string;
  target: {
    serviceId: string;
    environments?: Array<{
      environment: string;
      baseUrl?: string;
      status?: ServiceLifecycleStatus | string;
    }>;
  };
}): {
  environment: ApicenterRuntimeEnvironment;
  baseUrl: string;
  status?: ServiceLifecycleStatus | string;
} {
  if (!input.callerEnvironment) {
    throw new ForbiddenError("APICenter token is missing environment");
  }
  if (!isApicenterRuntimeEnvironment(input.callerEnvironment)) {
    throw new ForbiddenError("APICenter token environment is invalid");
  }

  const record = input.target.environments?.find(
    (env) => env.environment === input.callerEnvironment,
  );
  if (!record?.baseUrl) {
    throw new ServiceUnavailableError(
      `Service '${input.target.serviceId}' has no ${input.callerEnvironment} runtime URL`,
    );
  }
  if (record.status && record.status !== "active") {
    throw new ServiceUnavailableError(
      `Service '${input.target.serviceId}' ${input.callerEnvironment} environment is ${record.status}`,
    );
  }

  return {
    environment: input.callerEnvironment,
    baseUrl: record.baseUrl,
    status: record.status,
  };
}

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

export function stripApicenterIdentityHeaders(headers?: Record<string, unknown>): void {
  if (!headers) return;

  for (const headerName of Object.keys(headers)) {
    const normalized = headerName.toLowerCase();
    if (
      normalized.startsWith("x-apicenter-") ||
      normalized === "x-tribe-id" ||
      normalized === "x-source-service-id"
    ) {
      delete headers[headerName];
    }
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