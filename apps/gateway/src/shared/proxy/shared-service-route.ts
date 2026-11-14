import { ServiceUnavailableError } from "../errors";

/**
 * The runtime base URL for a shared service in one environment, from
 * SHARED_SERVICE_ROUTE_<SERVICE>_<ENVIRONMENT> (uppercased, hyphens as underscores).
 */
export function resolveSharedServiceRoute(
  sharedServiceId: string,
  environment: "test" | "live",
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = `SHARED_SERVICE_ROUTE_${sharedServiceId}_${environment}`.toUpperCase().replaceAll("-", "_");
  const targetUrl = env[key]?.trim();
  if (!targetUrl) {
    throw new ServiceUnavailableError(`Missing shared-service route ${key} for ${sharedServiceId} ${environment}`);
  }
  return targetUrl.replace(/\/+$/, "");
}
