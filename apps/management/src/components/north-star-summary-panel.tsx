"use client";

import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  NorthStarStatus,
  NorthStarSummary,
} from "@/lib/data-pipeline/north-star-summary";

export function NorthStarSummaryPanel({
  summary,
}: {
  summary: NorthStarSummary;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>North-star answer</CardTitle>
            <CardDescription>
              Trace tribe request, gateway decision, event export, cost, and BI
              readiness.
            </CardDescription>
          </div>
          <NorthStarStatusBadge status={summary.status} />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <p className="max-w-4xl text-sm leading-6 text-muted-foreground">
          {summary.answer}
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Total events" value={summary.metrics.totalEvents} />
          <Metric label="Tribes" value={summary.metrics.uniqueTribes} />
          <Metric
            label="Denied gateway decisions"
            value={summary.metrics.deniedGatewayDecisions}
          />
          <Metric label="Open signals" value={summary.metrics.openDecisionSignals} />
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {summary.questions.map((question) => (
            <div key={question.key} className="rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">{question.label}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {question.answer}
                  </p>
                </div>
                <NorthStarStatusBadge status={question.status} compact />
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                {question.evidenceCount} evidence row(s)
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function NorthStarStatusBadge({
  status,
  compact = false,
}: {
  status: NorthStarStatus;
  compact?: boolean;
}) {
  if (status === "complete") {
    return (
      <Badge className="bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]">
        <CheckCircle2Icon data-icon="inline-start" />
        {compact ? "Ready" : "Traceable"}
      </Badge>
    );
  }

  if (status === "warning") {
    return (
      <Badge variant="outline">
        <AlertTriangleIcon data-icon="inline-start" />
        Review
      </Badge>
    );
  }

  return (
    <Badge variant="secondary">
      <CircleDashedIcon data-icon="inline-start" />
      Missing
    </Badge>
  );
}
