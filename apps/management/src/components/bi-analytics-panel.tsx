"use client";

import {
  BarChart3Icon,
  CheckCircle2Icon,
  CircleAlertIcon,
  CircleDashedIcon,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  PipelineAthenaCostRow,
  PipelineDecisionSignalRow,
  PipelineGatewayDecisionRow,
  PipelineHealthRow,
  PipelineQualityRow,
  PipelineSharedServiceUsageRow,
} from "@/lib/schemas";

export function BiAnalyticsPanel({
  healthRows = [],
  qualityRows = [],
  sharedServiceUsageRows = [],
  gatewayDecisionRows = [],
  costRows = [],
  decisionSignalRows = [],
}: {
  healthRows?: PipelineHealthRow[];
  qualityRows?: PipelineQualityRow[];
  sharedServiceUsageRows?: PipelineSharedServiceUsageRow[];
  gatewayDecisionRows?: PipelineGatewayDecisionRow[];
  costRows?: PipelineAthenaCostRow[];
  decisionSignalRows?: PipelineDecisionSignalRow[];
}) {
  const totalEvents = sum(healthRows, (row) => row.eventCount);
  const validEvents = sum(qualityRows, (row) => row.validEventCount);
  const qualityEvents = sum(qualityRows, (row) => row.eventCount);
  const allowedDecisions = sum(gatewayDecisionRows, (row) => row.allowedCount);
  const totalDecisions = sum(gatewayDecisionRows, (row) => row.decisionCount);
  const successfulSharedCalls = sum(
    sharedServiceUsageRows,
    (row) => row.successCount,
  );
  const totalSharedCalls = sum(sharedServiceUsageRows, (row) => row.eventCount);
  const estimatedCostUsd = sum(costRows, (row) => row.estimatedCostUsd);
  const openBlockers = decisionSignalRows.filter(
    (row) => row.status === "open" || row.status === "blocked",
  );
  const topTribes = rankBy(
    healthRows,
    (row) => row.tribeId,
    (row) => row.eventCount,
  );
  const topSharedServices = rankBy(
    sharedServiceUsageRows,
    (row) => row.sharedServiceId,
    (row) => row.eventCount,
  );
  const pipelineStages = [
    {
      label: "Raw observed",
      ready: healthRows.length > 0,
      detail: `${healthRows.length} health row(s)`,
    },
    {
      label: "Common Silver",
      ready:
        healthRows.some((row) => row.latestCommonSilverObservedAt) ||
        qualityRows.length > 0 ||
        sharedServiceUsageRows.length > 0,
      detail: `${qualityRows.length + sharedServiceUsageRows.length} curated row(s)`,
    },
    {
      label: "Gold visible",
      ready:
        qualityRows.length > 0 ||
        gatewayDecisionRows.length > 0 ||
        costRows.length > 0,
      detail: `${qualityRows.length + gatewayDecisionRows.length + costRows.length} BI source row(s)`,
    },
    {
      label: "Signals clear",
      ready: openBlockers.length === 0,
      detail: `${openBlockers.length} open blocker(s)`,
    },
  ];
  const adoptionAnswer =
    totalEvents > 0
      ? `${topTribes.length} tribe(s) produced ${formatInteger(totalEvents)} event(s) in this selection.`
      : "No event volume is available for this environment and partition.";
  const reliabilityAnswer =
    totalDecisions > 0 || totalSharedCalls > 0 || qualityEvents > 0
      ? `${formatPercent(validEvents, qualityEvents)} valid events, ${formatPercent(allowedDecisions, totalDecisions)} gateway allow rate, and ${formatPercent(successfulSharedCalls, totalSharedCalls)} shared-service success.`
      : "Reliability cannot be answered until quality, gateway, or shared-service rows exist.";
  const pipelineAnswer = pipelineStages.every((stage) => stage.ready)
    ? "The selected data is ready for a governed BI refresh."
    : "One or more pipeline stages still need data before this is dashboard-ready.";
  const costAnswer = costRows.length
    ? `${costRows.length} cost row(s) estimate ${formatCurrency(estimatedCostUsd)} in Athena scan cost.`
    : "No Athena cost rows are available for this selection.";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Analytics dashboard</CardTitle>
            <CardDescription>
              Governed business signals, pipeline readiness, and supporting
              evidence for the selected partition.
            </CardDescription>
          </div>
          <Badge variant="outline">
            <BarChart3Icon data-icon="inline-start" />
            Gold ready
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Metric label="Curated events" value={formatInteger(totalEvents)} />
          <Metric
            label="Valid-event rate"
            value={formatPercent(validEvents, qualityEvents)}
          />
          <Metric
            label="Gateway allow rate"
            value={formatPercent(allowedDecisions, totalDecisions)}
          />
          <Metric
            label="Shared-service success"
            value={formatPercent(successfulSharedCalls, totalSharedCalls)}
          />
          <Metric label="Athena scan cost" value={formatCurrency(estimatedCostUsd)} />
        </div>

        {openBlockers.length ? (
          <Alert variant="destructive">
            <CircleAlertIcon data-icon="inline-start" />
            <AlertTitle>{openBlockers.length} open blocker(s)</AlertTitle>
            <AlertDescription>
              Resolve open or blocked decision signals before treating the BI view
              as ready for review.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-2">
          <BarChart
            title="Event volume by tribe"
            rows={topTribes}
            total={totalEvents}
            unit="event volume"
          />
          <BarChart
            title="Shared-service demand"
            rows={topSharedServices}
            total={totalSharedCalls}
            unit="shared-service calls"
          />
        </div>

        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h3 className="text-sm font-medium">Pipeline readiness</h3>
          <div className="grid gap-2 md:grid-cols-4">
            {pipelineStages.map((stage) => (
              <PipelineStage key={stage.label} {...stage} />
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h3 className="text-sm font-medium">Supporting questions</h3>
          <div className="grid gap-3 lg:grid-cols-2">
            <Question
              question="Can BI explain adoption?"
              answer={adoptionAnswer}
              ready={totalEvents > 0}
            />
            <Question
              question="Are failures low enough to publish?"
              answer={reliabilityAnswer}
              ready={
                qualityEvents > 0 &&
                totalDecisions > 0 &&
                totalSharedCalls > 0 &&
                openBlockers.length === 0
              }
            />
            <Question
              question="Is the pipeline complete?"
              answer={pipelineAnswer}
              ready={pipelineStages.every((stage) => stage.ready)}
            />
            <Question
              question="Can we estimate query cost?"
              answer={costAnswer}
              ready={costRows.length > 0}
            />
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-24 flex-col justify-between rounded-lg border p-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function BarChart({
  title,
  rows,
  total,
  unit,
}: {
  title: string;
  rows: Array<{ id: string; value: number }>;
  total: number;
  unit: string;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length ? (
        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-[minmax(7rem,12rem)_1fr_auto] items-center gap-3 text-sm"
            >
              <span className="font-mono text-xs">{row.id}</span>
              <div
                aria-label={`${row.id} ${unit} ${row.value} of ${total}`}
                className="h-2 overflow-hidden rounded bg-muted"
                role="img"
              >
                <div
                  className="h-full rounded bg-foreground"
                  style={{ width: `${Math.max(4, percentage(row.value, total))}%` }}
                />
              </div>
              <span className="font-semibold tabular-nums">
                {formatInteger(row.value)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No governed rows are available for this ranking yet.
        </p>
      )}
    </section>
  );
}

function PipelineStage({
  label,
  ready,
  detail,
}: {
  label: string;
  ready: boolean;
  detail: string;
}) {
  return (
    <div className="flex min-h-24 flex-col justify-between rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        {ready ? (
          <CheckCircle2Icon
            aria-label={`${label} ready`}
            className="size-4 text-[var(--brand-green-deep)]"
          />
        ) : (
          <CircleDashedIcon
            aria-label={`${label} missing`}
            className="size-4 text-muted-foreground"
          />
        )}
      </div>
      <span className="text-xs text-muted-foreground">{detail}</span>
    </div>
  );
}

function Question({
  question,
  answer,
  ready,
}: {
  question: string;
  answer: string;
  ready: boolean;
}) {
  return (
    <div className="flex min-h-28 flex-col justify-between rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <h4 className="text-sm font-medium">{question}</h4>
        <Badge variant={ready ? "outline" : "secondary"}>
          {ready ? "Answered" : "Needs data"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{answer}</p>
    </div>
  );
}

function rankBy<T>(
  rows: T[],
  getId: (row: T) => string,
  getValue: (row: T) => number,
) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const id = getId(row);
    totals.set(id, (totals.get(id) ?? 0) + getValue(row));
  }

  return [...totals.entries()]
    .map(([id, value]) => ({ id, value }))
    .sort((left, right) => right.value - left.value || left.id.localeCompare(right.id))
    .slice(0, 5);
}

function sum<T>(rows: T[], select: (row: T) => number | undefined) {
  return rows.reduce((total, row) => total + (select(row) ?? 0), 0);
}

function formatPercent(numerator: number, denominator: number) {
  if (denominator <= 0) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function percentage(value: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}
