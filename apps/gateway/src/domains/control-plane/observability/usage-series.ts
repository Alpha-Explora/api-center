// Usage over time from cp_usage_records: admitted application requests per UTC hour (24h) or UTC
// day (7d, 30d), by application and by action. Pure; the service runs the grouped query.

import { z } from "zod";

export const usageRangeQuery = z.object({ range: z.enum(["24h", "7d", "30d"]).default("24h") }).strict();
export type UsageRange = z.infer<typeof usageRangeQuery>["range"];
export type UsageBucket = "hour" | "day";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const RANGES: Record<UsageRange, { bucket: UsageBucket; count: number }> = {
  "24h": { bucket: "hour", count: 24 },
  "7d": { bucket: "day", count: 7 },
  "30d": { bucket: "day", count: 30 },
};

/** Bucket starts, oldest first; the last bucket is the current hour or UTC day. */
export function usageWindow(range: UsageRange, now: Date): { bucket: UsageBucket; starts: Date[] } {
  const { bucket, count } = RANGES[range];
  const size = bucket === "hour" ? HOUR_MS : DAY_MS;
  const current = Math.floor(now.getTime() / size) * size;
  return { bucket, starts: Array.from({ length: count }, (_, index) => new Date(current - (count - 1 - index) * size)) };
}

/** One row of the grouped query: requests in one bucket for one application, action and outcome. */
export interface UsageRow {
  bucketStart: Date;
  applicationId: string;
  capability: string;
  action: string;
  outcome: string;
  requests: number;
}

export interface UsagePoint {
  start: string;
  requests: number;
  failed: number;
}

export interface UsageSeries {
  range: UsageRange;
  bucket: UsageBucket;
  from: string;
  to: string;
  totals: { requests: number; failed: number };
  series: UsagePoint[];
  byApplication: { applicationId: string; requests: number; failed: number; series: number[] }[];
  byAction: { capability: string; action: string; requests: number; failed: number }[];
}

export function buildUsageSeries(range: UsageRange, now: Date, rows: UsageRow[]): UsageSeries {
  const { bucket, starts } = usageWindow(range, now);
  const index = new Map(starts.map((start, position) => [start.getTime(), position]));
  const series = starts.map((start) => ({ start: start.toISOString(), requests: 0, failed: 0 }));
  const applications = new Map<string, { applicationId: string; requests: number; failed: number; series: number[] }>();
  const actions = new Map<string, { capability: string; action: string; requests: number; failed: number }>();

  for (const row of rows) {
    const position = index.get(row.bucketStart.getTime());
    if (position === undefined) continue;
    const failed = row.outcome === "failed" ? row.requests : 0;
    series[position].requests += row.requests;
    series[position].failed += failed;

    const application = applications.get(row.applicationId) ?? {
      applicationId: row.applicationId,
      requests: 0,
      failed: 0,
      series: starts.map(() => 0),
    };
    application.requests += row.requests;
    application.failed += failed;
    application.series[position] += row.requests;
    applications.set(row.applicationId, application);

    const actionKey = `${row.capability}|${row.action}`;
    const action = actions.get(actionKey) ?? { capability: row.capability, action: row.action, requests: 0, failed: 0 };
    action.requests += row.requests;
    action.failed += failed;
    actions.set(actionKey, action);
  }

  const byRequests = (left: { requests: number }, right: { requests: number }) => right.requests - left.requests;
  return {
    range,
    bucket,
    from: starts[0].toISOString(),
    to: now.toISOString(),
    totals: {
      requests: series.reduce((sum, point) => sum + point.requests, 0),
      failed: series.reduce((sum, point) => sum + point.failed, 0),
    },
    series,
    byApplication: [...applications.values()].sort(byRequests),
    byAction: [...actions.values()].sort(byRequests),
  };
}
