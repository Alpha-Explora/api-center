export type ManagementSourceType =
  | "durable"
  | "volatile"
  | "external"
  | "computed"
  | "unavailable";

export type ManagementSourceDurability =
  | "postgres"
  | "redis-window"
  | "provider-api"
  | "athena"
  | "computed-projection"
  | "none";

export type ManagementSourceWindow = "15m" | "1h" | "24h" | "7d" | "30d";

export interface ManagementSourceMetadata {
  sourceType: ManagementSourceType;
  sourceName: string;
  durability: ManagementSourceDurability;
  window?: ManagementSourceWindow;
  lastRefreshedAt?: string;
  staleAfterSeconds?: number;
  degradedReason?: string;
  evidenceTable?: string;
  correlationId?: string;
}

const WINDOW_SECONDS: Record<ManagementSourceWindow, number> = {
  "1h": 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
  "15m": 15 * 60,
};

export function redisWindowSourceMetadata(input: {
  sourceName: string;
  window: ManagementSourceWindow;
  now?: Date;
  degradedReason?: string;
  correlationId?: string;
}): ManagementSourceMetadata {
  return {
    sourceType: "volatile",
    sourceName: input.sourceName,
    durability: "redis-window",
    window: input.window,
    lastRefreshedAt: (input.now ?? new Date()).toISOString(),
    staleAfterSeconds: WINDOW_SECONDS[input.window],
    degradedReason: input.degradedReason,
    correlationId: input.correlationId,
  };
}

export function durablePostgresSourceMetadata(input: {
  sourceName: string;
  evidenceTable: string;
  now?: Date;
  correlationId?: string;
}): ManagementSourceMetadata {
  return {
    sourceType: "durable",
    sourceName: input.sourceName,
    durability: "postgres",
    lastRefreshedAt: (input.now ?? new Date()).toISOString(),
    evidenceTable: input.evidenceTable,
    correlationId: input.correlationId,
  };
}

export function computedSourceMetadata(input: {
  sourceName: string;
  now?: Date;
  degradedReason?: string;
  correlationId?: string;
}): ManagementSourceMetadata {
  return {
    sourceType: input.degradedReason ? "unavailable" : "computed",
    sourceName: input.sourceName,
    durability: input.degradedReason ? "none" : "computed-projection",
    lastRefreshedAt: (input.now ?? new Date()).toISOString(),
    degradedReason: input.degradedReason,
    correlationId: input.correlationId,
  };
}

export function volatileSourceMetadata(input: {
  sourceName: string;
  now?: Date;
  degradedReason?: string;
  correlationId?: string;
}): ManagementSourceMetadata {
  return {
    sourceType: "volatile",
    sourceName: input.sourceName,
    durability: "none",
    lastRefreshedAt: (input.now ?? new Date()).toISOString(),
    degradedReason: input.degradedReason,
    correlationId: input.correlationId,
  };
}

export function externalSourceMetadata(input: {
  sourceName: string;
  durability: Extract<ManagementSourceDurability, "athena" | "provider-api">;
  now?: Date;
  staleAfterSeconds?: number;
  degradedReason?: string;
  evidenceTable?: string;
  correlationId?: string;
}): ManagementSourceMetadata {
  return {
    sourceType: "external",
    sourceName: input.sourceName,
    durability: input.durability,
    lastRefreshedAt: (input.now ?? new Date()).toISOString(),
    staleAfterSeconds: input.staleAfterSeconds,
    degradedReason: input.degradedReason,
    evidenceTable: input.evidenceTable,
    correlationId: input.correlationId,
  };
}
