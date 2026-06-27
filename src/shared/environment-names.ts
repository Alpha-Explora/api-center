import {
  APICENTER_RUNTIME_ENVIRONMENT_KEYS,
  ApicenterRuntimeEnvironment,
  isApicenterRuntimeEnvironment,
} from "../types";

export type PhysicalPipelineEnvironment = "test" | "prod";

export const LIVE_RUNTIME_ENVIRONMENT: ApicenterRuntimeEnvironment = "live";

export function assertRuntimeEnvironment(
  value: unknown,
): ApicenterRuntimeEnvironment {
  if (isApicenterRuntimeEnvironment(value)) return value;
  throw new Error(
    `runtimeEnvironment must be one of: ${APICENTER_RUNTIME_ENVIRONMENT_KEYS.join(", ")}`,
  );
}

export function toPhysicalPipelineEnvironment(
  runtimeEnvironment: ApicenterRuntimeEnvironment,
): PhysicalPipelineEnvironment {
  return runtimeEnvironment === "live" ? "prod" : "test";
}
