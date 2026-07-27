import { z } from "zod";

const providerNameSchema = z.enum(["local-file", "api-center"]);
const partitionDateQuerySchema = z.object({
  year: z.string().regex(/^\d{4}$/, "year must be 4 digits"),
  month: z.string().regex(/^\d{2}$/, "month must be 2 digits"),
  day: z.string().regex(/^\d{2}$/, "day must be 2 digits"),
});
const windowDaysQuerySchema = z.coerce
  .number()
  .int("windowDays must be a whole number")
  .min(1, "windowDays must be between 1 and 90")
  .max(90, "windowDays must be between 1 and 90");

export type PipelineHealthProvider = {
  readRows(
    environment?: string,
    partition?: PipelinePartitionDate,
  ): Promise<unknown[]>;
};

export type PipelineHealthResponseSource = "evidence-file" | "athena-proxy";
export type PipelinePartitionDate = {
  year: string;
  month: string;
  day: string;
};

export class ApiCenterPipelineHealthProvider implements PipelineHealthProvider {
  private readonly baseUrl?: string;
  private readonly platformSecret?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options?: {
    baseUrl?: string;
    platformSecret?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.baseUrl = options?.baseUrl;
    this.platformSecret = options?.platformSecret;
    this.fetchImpl = options?.fetchImpl ?? fetch;
  }

  async readRows(
    environment = "test",
    partition?: PipelinePartitionDate,
  ): Promise<unknown[]> {
    const platformSecret =
      this.platformSecret ?? process.env.API_CENTER_PLATFORM_ADMIN_SECRET;
    if (!platformSecret) {
      throw new Error(
        "API_CENTER_PLATFORM_ADMIN_SECRET is required when PIPELINE_HEALTH_PROVIDER=api-center.",
      );
    }

    const baseUrl = (
      this.baseUrl ??
      process.env.API_CENTER_BASE_URL ??
      "https://api-center.itsandbox.site"
    ).replace(/\/$/, "");
    const params = new URLSearchParams({ environment });
    appendPartitionParams(params, partition);
    const response = await this.fetchImpl(
      `${baseUrl}/api/v1/data-pipeline/health?${params.toString()}`,
      {
        headers: {
          "content-type": "application/json",
          "x-platform-secret": platformSecret,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      },
    );
    const body = await response.json();

    if (!response.ok || body?.success !== true || !Array.isArray(body.data)) {
      throw new Error(
        body?.error ??
          `API Center pipeline health request failed with ${response.status}.`,
      );
    }

    return body.data;
  }
}

export function parsePipelinePartitionDate(
  searchParams: URLSearchParams,
): PipelinePartitionDate | undefined {
  const year = searchParams.get("year") ?? undefined;
  const month = searchParams.get("month") ?? undefined;
  const day = searchParams.get("day") ?? undefined;
  const values = [year, month, day].filter((value) => value !== undefined);
  if (values.length === 0) return undefined;
  return partitionDateQuerySchema.parse({ year, month, day });
}

export function appendPartitionParams(
  params: URLSearchParams,
  partition: PipelinePartitionDate | undefined,
) {
  if (!partition) return;
  params.set("year", partition.year);
  params.set("month", partition.month);
  params.set("day", partition.day);
}

export function parsePipelineWindowDays(
  searchParams: URLSearchParams,
): number | undefined {
  const value = searchParams.get("windowDays");
  if (value === null || value.trim() === "") return undefined;
  return windowDaysQuerySchema.parse(value);
}

export function appendWindowParams(
  params: URLSearchParams,
  windowDays: number | undefined,
) {
  if (!windowDays) return;
  params.set("windowDays", String(windowDays));
}

export async function resolvePipelineHealthProvider(options?: {
  filePath?: string;
  providerName?: string;
}): Promise<PipelineHealthProvider> {
  const providerName = resolvePipelineHealthProviderName(options?.providerName);

  if (providerName === "api-center") {
    return new ApiCenterPipelineHealthProvider();
  }

  if (process.env.NODE_ENV !== "production") {
    const { LocalFilePipelineHealthProvider } = await import(
      "./pipeline-health-local-provider"
    );
    return new LocalFilePipelineHealthProvider({ filePath: options?.filePath });
  }

  throw new Error(
    "PIPELINE_HEALTH_PROVIDER=local-file is only supported in local development and tests. Use PIPELINE_HEALTH_PROVIDER=api-center in deployed management.",
  );
}

export function resolvePipelineHealthResponseSource(
  providerName?: string,
): PipelineHealthResponseSource {
  return resolvePipelineHealthProviderName(providerName) === "api-center"
    ? "athena-proxy"
    : "evidence-file";
}

function resolvePipelineHealthProviderName(providerName?: string) {
  if (providerName) return providerNameSchema.parse(providerName);
  if (process.env.PIPELINE_HEALTH_PROVIDER) {
    return providerNameSchema.parse(process.env.PIPELINE_HEALTH_PROVIDER);
  }
  if (
    process.env.API_CENTER_PLATFORM_ADMIN_SECRET ||
    process.env.NODE_ENV === "production"
  ) {
    return "api-center";
  }
  return "local-file";
}
