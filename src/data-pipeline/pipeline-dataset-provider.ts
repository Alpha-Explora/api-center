import { ValidationError } from "../shared/errors";

export type PipelineDatasetProvider<T> = {
  listRows(): Promise<T[]>;
};

export type PipelineDatasetSource = "fixture" | "athena";

export function resolvePipelineDatasetSource(
  candidates: Array<string | undefined>,
  errorMessage: string,
): PipelineDatasetSource {
  const source = candidates.find((candidate) => candidate !== undefined) ?? "fixture";
  if (source === "fixture" || source === "athena") return source;
  throw new ValidationError(errorMessage);
}

export function resolvePositiveQueryLimit(
  configured: number | undefined,
  fallback: number,
): number {
  if (
    typeof configured === "number" &&
    Number.isFinite(configured) &&
    configured > 0
  ) {
    return configured;
  }

  return Number.isFinite(fallback) && fallback > 0 ? fallback : 100;
}
