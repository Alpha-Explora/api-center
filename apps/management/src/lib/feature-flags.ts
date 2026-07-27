export function isDataPipelineEnabled() {
  return (
    process.env.NEXT_PUBLIC_DATA_PIPELINE_ENABLED === "true" ||
    process.env.DATA_PIPELINE_ENABLED === "true"
  );
}

export function getManagementTargetEnvironments() {
  return ["test", "live"] as const;
}

export function isOneApiCenterTopologyEnabled(input?: {
  apiCenterBaseUrl?: string;
  publicApiCenterBaseUrl?: string;
}) {
  const apiCenterBaseUrl = normalizeUrl(
    input?.apiCenterBaseUrl ?? process.env.API_CENTER_BASE_URL,
  );
  const publicApiCenterBaseUrl = normalizeUrl(
    input?.publicApiCenterBaseUrl ??
      process.env.NEXT_PUBLIC_API_CENTER_BASE_URL,
  );

  return Boolean(
    apiCenterBaseUrl &&
    publicApiCenterBaseUrl &&
    apiCenterBaseUrl === publicApiCenterBaseUrl,
  );
}

function normalizeUrl(value: string | undefined) {
  return (value || "").trim().replace(/\/+$/, "");
}
