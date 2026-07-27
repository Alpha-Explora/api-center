export type NorthStarBiProvider =
  | "none"
  | "powerbi"
  | "looker"
  | "looker-studio";

export type NorthStarBiConfig = {
  enabled: boolean;
  provider: NorthStarBiProvider;
  embedUrl?: string;
  dashboardId?: string;
  allowedHost?: string;
};

export function getNorthStarBiConfig(
  env: NodeJS.ProcessEnv = process.env,
): NorthStarBiConfig {
  const provider = readProvider(env);
  const dashboardId = cleanOptional(
    env.BI_NORTH_STAR_DASHBOARD_ID ?? env.POWERBI_NORTH_STAR_REPORT_ID,
  );
  const embedUrl = cleanOptional(
    env.BI_NORTH_STAR_EMBED_URL ?? env.POWERBI_NORTH_STAR_EMBED_URL,
  );
  const allowedHost = cleanHost(
    env.BI_NORTH_STAR_ALLOWED_HOST ?? env.LOOKER_NORTH_STAR_ALLOWED_HOST,
  );

  if (!readEnabled(env)) {
    return disabledConfig("none", { dashboardId, allowedHost });
  }

  if (!embedUrl || provider === "none") {
    return disabledConfig(provider, { dashboardId, allowedHost });
  }

  if (!isAllowedProviderUrl(provider, embedUrl, allowedHost)) {
    return disabledConfig(provider, { dashboardId, allowedHost });
  }

  return {
    enabled: true,
    provider,
    embedUrl,
    dashboardId,
    allowedHost,
  };
}

function disabledConfig(
  provider: NorthStarBiProvider,
  metadata: Pick<NorthStarBiConfig, "dashboardId" | "allowedHost"> = {},
): NorthStarBiConfig {
  return {
    enabled: false,
    provider,
    embedUrl: undefined,
    dashboardId: metadata.dashboardId,
    allowedHost: metadata.allowedHost,
  };
}

function readEnabled(env: NodeJS.ProcessEnv) {
  return (
    env.BI_NORTH_STAR_ENABLED === "true" ||
    env.POWERBI_NORTH_STAR_ENABLED === "true"
  );
}

function readProvider(env: NodeJS.ProcessEnv): NorthStarBiProvider {
  const value = cleanOptional(env.BI_NORTH_STAR_PROVIDER);
  if (value === "powerbi" || value === "looker" || value === "looker-studio") {
    return value;
  }

  if (env.POWERBI_NORTH_STAR_ENABLED === "true") return "powerbi";
  return "none";
}

function isAllowedProviderUrl(
  provider: NorthStarBiProvider,
  value: string,
  allowedHost: string | undefined,
) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") return false;

    if (provider === "powerbi") {
      return hostMatches(parsed.hostname, "powerbi.com");
    }

    if (provider === "looker-studio") {
      return (
        parsed.hostname === "lookerstudio.google.com" ||
        parsed.hostname === "datastudio.google.com"
      );
    }

    if (provider === "looker") {
      return Boolean(allowedHost) && parsed.hostname === allowedHost;
    }

    return false;
  } catch {
    return false;
  }
}

function hostMatches(hostname: string, allowedDomain: string) {
  return hostname === allowedDomain || hostname.endsWith(`.${allowedDomain}`);
}

function cleanOptional(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function cleanHost(value: string | undefined) {
  const trimmed = cleanOptional(value);
  return trimmed?.toLowerCase();
}
