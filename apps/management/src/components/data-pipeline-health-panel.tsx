"use client";

import { AlertTriangleIcon, CheckCircle2Icon, LoaderCircleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DataPipelineFeedbackActions,
  PIPELINE_FEEDBACK_ACTION_GROUPS,
} from "@/components/data-pipeline-feedback-actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type PipelineHealthRow = {
  environment: "test" | "prod";
  tribeId: string;
  sourceServiceId?: string;
  eventType: string;
  eventDay: string;
  eventCount: number;
  latestOccurredAt?: string;
  latestIngestedAt?: string;
  latestS3ObjectKey?: string;
};

const DEFAULT_STALE_AFTER_HOURS = 24;

export function DataPipelineHealthPanel({
  rows = [],
  loading = false,
  now = new Date(),
  staleAfterHours = DEFAULT_STALE_AFTER_HOURS,
}: {
  rows?: PipelineHealthRow[];
  loading?: boolean;
  now?: Date;
  staleAfterHours?: number;
}) {
  const hasRows = rows.length > 0;
  const hasProdRows = rows.some((row) => row.environment === "prod");
  const hasOnlyTestRows = hasRows && !hasProdRows;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Data pipeline health</CardTitle>
        <CardDescription>
          Gold pipeline-health rows by environment, tribe, service, event, and day.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <Alert>
            <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
            <AlertTitle>Loading pipeline health</AlertTitle>
            <AlertDescription>
              Reading the curated pipeline-health output.
            </AlertDescription>
          </Alert>
        ) : null}

        {!loading && !hasRows ? (
          <Alert>
            <AlertTitle>No pipeline health rows yet</AlertTitle>
            <AlertDescription>
              No curated Gold pipeline-health output is available for this view.
            </AlertDescription>
          </Alert>
        ) : null}

        {!loading && hasOnlyTestRows ? (
          <Alert>
            <AlertTriangleIcon data-icon="inline-start" />
            <AlertTitle>Test data only</AlertTitle>
            <AlertDescription>
              Current rows are isolated to the test environment.
            </AlertDescription>
          </Alert>
        ) : null}

        {!loading && hasRows ? (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Environment</TableHead>
                  <TableHead>Tribe</TableHead>
                  <TableHead>Source service</TableHead>
                  <TableHead>Event type</TableHead>
                  <TableHead>Event day</TableHead>
                  <TableHead>Daily count</TableHead>
                  <TableHead>Latest event time</TableHead>
                  <TableHead>Latest ingestion time</TableHead>
                  <TableHead>Freshness</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const freshness = getFreshnessStatus(row, now, staleAfterHours);

                  return (
                    <TableRow
                      key={[
                        row.environment,
                        row.tribeId,
                        row.sourceServiceId ?? "unknown-source",
                        row.eventType,
                        row.eventDay,
                      ].join(":")}
                    >
                      <TableCell>
                        <Badge variant={row.environment === "prod" ? "default" : "outline"}>
                          {row.environment}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.tribeId}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {row.sourceServiceId ?? "Unknown"}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.eventType}</TableCell>
                      <TableCell>{row.eventDay}</TableCell>
                      <TableCell>{row.eventCount}</TableCell>
                      <TableCell>{formatTimestamp(row.latestOccurredAt)}</TableCell>
                      <TableCell>{formatTimestamp(row.latestIngestedAt)}</TableCell>
                      <TableCell>
                        <FreshnessBadge status={freshness} />
                      </TableCell>
                      <TableCell>
                        <DataPipelineFeedbackActions
                          environment={row.environment}
                          targetType="event"
                          targetId={row.eventType}
                          ownerTribeId={row.tribeId}
                          evidenceLink={row.latestS3ObjectKey}
                          actions={PIPELINE_FEEDBACK_ACTION_GROUPS.health}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

type FreshnessStatus = "fresh" | "stale" | "unknown";

function FreshnessBadge({ status }: { status: FreshnessStatus }) {
  if (status === "fresh") {
    return (
      <Badge className="bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]">
        <CheckCircle2Icon data-icon="inline-start" />
        Fresh
      </Badge>
    );
  }

  if (status === "stale") {
    return (
      <Badge className="bg-[#fff7f7] text-destructive">
        <AlertTriangleIcon data-icon="inline-start" />
        Stale ingestion
      </Badge>
    );
  }

  return <Badge variant="secondary">Unknown</Badge>;
}

function getFreshnessStatus(
  row: PipelineHealthRow,
  now: Date,
  staleAfterHours: number,
): FreshnessStatus {
  if (!row.latestIngestedAt) return "unknown";

  const ingestedAt = new Date(row.latestIngestedAt);
  if (Number.isNaN(ingestedAt.getTime())) return "unknown";

  const staleAfterMs = staleAfterHours * 60 * 60 * 1000;
  return now.getTime() - ingestedAt.getTime() > staleAfterMs ? "stale" : "fresh";
}

function formatTimestamp(value: string | undefined) {
  if (!value) return "Unknown";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toISOString();
}
