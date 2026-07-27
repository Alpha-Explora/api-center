export type RuntimeEnvironment = "test" | "live";
export type PipelineLane = "test" | "prod";
export type ManagementDeploymentEnvironment = "local" | "test" | "live";

export class EnvironmentNameError extends Error {
  override name = "EnvironmentNameError";
}

export function isEnvironmentNameError(
  error: unknown,
): error is EnvironmentNameError {
  return error instanceof EnvironmentNameError;
}

export function parseRuntimeEnvironment(value: unknown): RuntimeEnvironment {
  if (value === "test" || value === "live") return value;
  throw new EnvironmentNameError("runtimeEnvironment must be one of: test, live");
}

export function parsePipelineLane(value: unknown): PipelineLane {
  if (value === "test" || value === "prod") return value;
  throw new EnvironmentNameError("pipelineLane must be one of: test, prod");
}

export function parseManagementDeploymentEnvironment(
  value: unknown,
): ManagementDeploymentEnvironment {
  if (value === "local" || value === "test" || value === "live") {
    return value;
  }
  throw new EnvironmentNameError(
    "managementDeploymentEnvironment must be one of: local, test, live",
  );
}

export function toPipelineLane(
  runtimeEnvironment: RuntimeEnvironment,
): PipelineLane {
  return runtimeEnvironment === "live" ? "prod" : "test";
}

export function toRuntimeEnvironment(pipelineLane: PipelineLane): RuntimeEnvironment {
  return pipelineLane === "prod" ? "live" : "test";
}

export function toPlanStorageEnvironment(
  environment: unknown,
): PipelineLane {
  if (environment === "prod") return "prod";
  return toPipelineLane(parseRuntimeEnvironment(environment));
}

export function readPipelineLaneQuery(searchParams: URLSearchParams): PipelineLane {
  const pipelineLane = searchParams.get("pipelineLane");
  if (pipelineLane !== null) return parsePipelineLane(pipelineLane);

  const legacyEnvironment = searchParams.get("environment");
  if (legacyEnvironment === null) return "test";
  if (legacyEnvironment === "prod") return "prod";
  return toPipelineLane(parseRuntimeEnvironment(legacyEnvironment));
}

export function displayRuntimeEnvironment(
  environment: RuntimeEnvironment | PipelineLane,
): RuntimeEnvironment {
  return environment === "prod" ? "live" : parseRuntimeEnvironment(environment);
}
