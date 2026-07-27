import { z } from "zod";
import {
  appendPartitionParams,
  appendWindowParams,
  type PipelinePartitionDate,
} from "./pipeline-health-provider";

const providerNameSchema = z.enum(["local-file", "api-center"]);
const metricKindSchema = z.enum([
  "quality",
  "shared-service-usage",
  "gateway-decisions",
  "cost",
  "decision-signals",
]);

export type PipelineGovernanceMetricKind = z.infer<typeof metricKindSchema>;
export type PipelineGovernanceResponseSource = "evidence-file" | "athena-proxy";
export type PipelineGovernanceReadResult = {
  rows: unknown[];
  source: PipelineGovernanceResponseSource;
};

export type PipelineGovernanceProvider = {
  readRows(
    kind: PipelineGovernanceMetricKind,
    environment?: string,
    partition?: PipelinePartitionDate,
    windowDays?: number,
  ): Promise<unknown[]>;
  readResponse?(
    kind: PipelineGovernanceMetricKind,
    environment?: string,
    partition?: PipelinePartitionDate,
    windowDays?: number,
  ): Promise<PipelineGovernanceReadResult>;
};

export class ApiCenterPipelineGovernanceProvider
  implements PipelineGovernanceProvider
{
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
    kind: PipelineGovernanceMetricKind,
    environment = "test",
    partition?: PipelinePartitionDate,
    windowDays?: number,
  ): Promise<unknown[]> {
    return (await this.readResponse(kind, environment, partition, windowDays))
      .rows;
  }

  async readResponse(
    kind: PipelineGovernanceMetricKind,
    environment = "test",
    partition?: PipelinePartitionDate,
    windowDays?: number,
  ): Promise<PipelineGovernanceReadResult> {
    const metricKind = metricKindSchema.parse(kind);
    const platformSecret =
      this.platformSecret ?? process.env.API_CENTER_PLATFORM_ADMIN_SECRET;
    if (!platformSecret) {
      throw new Error(
        "API_CENTER_PLATFORM_ADMIN_SECRET is required when PIPELINE_GOVERNANCE_PROVIDER=api-center.",
      );
    }

    const baseUrl = (
      this.baseUrl ??
      process.env.API_CENTER_BASE_URL ??
      "https://api-center.itsandbox.site"
    ).replace(/\/$/, "");
    const params = new URLSearchParams({ environment });
    appendPartitionParams(params, partition);
    appendWindowParams(params, windowDays);
    const response = await this.fetchImpl(
      `${baseUrl}/api/v1/data-pipeline/${metricKind}?${params.toString()}`,
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
          `API Center pipeline governance request failed with ${response.status}.`,
      );
    }

    return {
      rows: body.data,
      source: parseResponseSource(body?.meta?.source),
    };
  }
}

export async function resolvePipelineGovernanceProvider(options?: {
  filePath?: string;
  providerName?: string;
}): Promise<PipelineGovernanceProvider> {
  const providerName = resolvePipelineGovernanceProviderName(
    options?.providerName,
  );

  if (providerName === "api-center") {
    return new ApiCenterPipelineGovernanceProvider();
  }

  if (process.env.NODE_ENV !== "production") {
    const { LocalFilePipelineGovernanceProvider } = await import(
      "./pipeline-governance-local-provider"
    );
    return new LocalFilePipelineGovernanceProvider({ filePath: options?.filePath });
  }

  throw new Error(
    "PIPELINE_GOVERNANCE_PROVIDER=local-file is only supported in local development and tests. Use PIPELINE_GOVERNANCE_PROVIDER=api-center in deployed management.",
  );
}

export function resolvePipelineGovernanceResponseSource(providerName?: string) {
  return resolvePipelineGovernanceProviderName(providerName) === "api-center"
    ? "athena-proxy"
    : "evidence-file";
}

function resolvePipelineGovernanceProviderName(providerName?: string) {
  if (providerName) return providerNameSchema.parse(providerName);
  if (process.env.PIPELINE_GOVERNANCE_PROVIDER) {
    return providerNameSchema.parse(process.env.PIPELINE_GOVERNANCE_PROVIDER);
  }
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

function parseResponseSource(value: unknown): PipelineGovernanceResponseSource {
  return value === "evidence-file" || value === "athena-proxy"
    ? value
    : "athena-proxy";
}
