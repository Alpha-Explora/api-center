import { ValidationError } from "../shared/errors";
import {
  ApicenterRuntimeEnvironment,
  isApicenterRuntimeEnvironment,
} from "../types";

export const PHYSICAL_PIPELINE_ENVIRONMENTS = ["test", "prod"] as const;

export type PhysicalPipelineEnvironment =
  (typeof PHYSICAL_PIPELINE_ENVIRONMENTS)[number];

export type PipelineHealthEnvironment = ApicenterRuntimeEnvironment;
export type PipelineEnvironmentInput =
  | PipelineHealthEnvironment
  | PhysicalPipelineEnvironment;

export function parsePipelineRuntimeEnvironment(
  value: string | undefined,
): PipelineHealthEnvironment {
  const environment = value ?? "test";
  if (isApicenterRuntimeEnvironment(environment)) return environment;
  throw new ValidationError("environment must be one of: test, live");
}

export function toPhysicalPipelineEnvironment(
  environment: PipelineEnvironmentInput,
): PhysicalPipelineEnvironment {
  if (environment === "test") return "test";
  if (environment === "live" || environment === "prod") return "prod";
  throw new ValidationError("environment must be one of: test, live");
}

export function toPublicPipelineEnvironment(
  environment: unknown,
): PipelineHealthEnvironment {
  if (environment === "test" || environment === "live") return environment;
  if (environment === "prod") return "live";
  throw new ValidationError("environment must be one of: test, live");
}

export function pipelinePhysicalTopicForTribe(
  environment: PipelineEnvironmentInput,
  tribeId: string,
): string {
  return `${toPhysicalPipelineEnvironment(environment)}.tribe.${tribeId}.events`;
}