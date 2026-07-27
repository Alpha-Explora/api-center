"use client";

import Link from "next/link";
import { EyeIcon, ShieldAlertIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { ConsumerScorecard } from "@/lib/schemas";

type ScorecardSeverity = "critical" | "warning" | "info";

type ScorecardView = ConsumerScorecard & {
  severity: ScorecardSeverity;
  summary: string;
};

export function ConsumerScorecardPanel({
  scorecards,
}: {
  scorecards: ConsumerScorecard[];
}) {
  const [selectedOwnerTribeId, setSelectedOwnerTribeId] = useState<string>();
  const orderedScorecards = useMemo(
    () => scorecards.map(toScorecardView).sort(compareScorecards),
    [scorecards],
  );
  const selectedScorecard =
    orderedScorecards.find(
      (scorecard) => scorecard.ownerTribeId === selectedOwnerTribeId,
    ) ?? orderedScorecards[0];

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Consumer scorecards</h2>
      {orderedScorecards.length === 0 ? (
        <div className="rounded-md border">
          <p className="p-3 text-sm text-muted-foreground">
            No consumer scorecards available.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.8fr)]">
          <div className="overflow-hidden rounded-lg border">
            <div className="hidden grid-cols-[minmax(10rem,0.75fr)_8rem_minmax(0,1fr)_2.25rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
              <span>Consumer</span>
              <span>Severity</span>
              <span>Findings</span>
              <span className="sr-only">Inspect</span>
            </div>
            <div className="divide-y">
              {orderedScorecards.map((scorecard) => (
                <ScorecardRow
                  key={scorecard.ownerTribeId}
                  scorecard={scorecard}
                  selected={
                    selectedScorecard?.ownerTribeId === scorecard.ownerTribeId
                  }
                  onSelect={() =>
                    setSelectedOwnerTribeId(scorecard.ownerTribeId)
                  }
                />
              ))}
            </div>
          </div>
          {selectedScorecard ? (
            <ScorecardDetail scorecard={selectedScorecard} />
          ) : null}
        </div>
      )}
    </section>
  );
}

function ScorecardRow({
  scorecard,
  selected,
  onSelect,
}: {
  scorecard: ScorecardView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 text-sm md:grid-cols-[minmax(10rem,0.75fr)_8rem_minmax(0,1fr)_2.25rem] md:items-start">
      <div className="min-w-0">
        <div className="truncate font-medium">{scorecard.ownerTribeId}</div>
        <div className="truncate text-xs text-muted-foreground">
          {scorecard.status}
        </div>
      </div>
      <div className="col-start-1 md:col-auto">
        <Badge
          variant={scorecard.severity === "info" ? "secondary" : "destructive"}
        >
          {scorecard.severity}
        </Badge>
      </div>
      <p className="col-start-1 min-w-0 break-words text-muted-foreground md:col-auto">
        {scorecard.summary}
      </p>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect consumer compliance ${scorecard.ownerTribeId}`}
        title={`Inspect consumer compliance ${scorecard.ownerTribeId}`}
        onClick={onSelect}
        className="col-start-2 row-start-1 inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground md:col-auto md:row-auto"
      >
        <EyeIcon data-icon="inline-end" />
      </button>
    </div>
  );
}

function ScorecardDetail({ scorecard }: { scorecard: ScorecardView }) {
  return (
    <aside
      aria-label="Selected consumer scorecard detail"
      className="order-first rounded-lg border bg-muted/10 p-4 xl:order-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Selected consumer</div>
          <div className="mt-1 truncate text-base font-medium">
            {scorecard.ownerTribeId}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {scorecard.status}
          </div>
        </div>
        <Badge
          variant={scorecard.severity === "info" ? "secondary" : "destructive"}
        >
          {scorecard.severity}
        </Badge>
      </div>

      <dl className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-3">
        <Metric label="SDK" value={scorecard.sdkVersion ?? "unknown"} />
        <Metric
          label="Quota"
          value={`Quota usage ${formatPercent(scorecard.quotaUsagePercent)}`}
        />
        <Metric
          label="Errors"
          value={`Error rate ${formatPercent(scorecard.errorRatePercent)}`}
        />
      </dl>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">Findings</div>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {scorecard.summary}
        </p>
      </div>

      <div className="mt-4 grid gap-2 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">
          Next actions
        </div>
        <ActionLink
          href={`/tribes/${encodeURIComponent(scorecard.ownerTribeId)}?section=governance`}
          label="Open service detail"
        />
        <ActionLink
          href={serviceDetailHref(scorecard.ownerTribeId, "quotas")}
          label="Review quota usage"
        />
        <ActionLink
          href={serviceDetailHref(scorecard.ownerTribeId, "health")}
          label="Open reliability"
        />
        <ActionLink
          href={`/developer-portal?tribeId=${encodeURIComponent(scorecard.ownerTribeId)}`}
          label="Review developer handoff"
        />
      </div>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

function ActionLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex w-fit items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
    >
      {label}
      <ShieldAlertIcon data-icon="inline-end" />
    </Link>
  );
}

function toScorecardView(scorecard: ConsumerScorecard): ScorecardView {
  const summary =
    scorecard.findings.length === 0
      ? "No findings"
      : scorecard.findings.join(", ");

  return {
    ...scorecard,
    severity: scorecardSeverity(scorecard),
    summary,
  };
}

function scorecardSeverity(scorecard: ConsumerScorecard): ScorecardSeverity {
  const errorRate =
    typeof scorecard.errorRatePercent === "number"
      ? scorecard.errorRatePercent
      : 0;
  const quotaUsage =
    typeof scorecard.quotaUsagePercent === "number"
      ? scorecard.quotaUsagePercent
      : 0;

  if (
    /blocked|critical|needs_attention/i.test(scorecard.status) ||
    errorRate >= 5 ||
    quotaUsage >= 90
  ) {
    return "critical";
  }

  if (
    scorecard.findings.length > 0 ||
    scorecard.quotaUsagePercent === "unknown" ||
    scorecard.errorRatePercent === "unknown" ||
    sdkBehind(scorecard)
  ) {
    return "warning";
  }

  return "info";
}

function compareScorecards(left: ScorecardView, right: ScorecardView) {
  const severityDelta = severityRank(left.severity) - severityRank(right.severity);
  if (severityDelta !== 0) return severityDelta;
  const findingDelta = right.findings.length - left.findings.length;
  if (findingDelta !== 0) return findingDelta;
  return left.ownerTribeId.localeCompare(right.ownerTribeId);
}

function severityRank(severity: ScorecardSeverity) {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function sdkBehind(scorecard: ConsumerScorecard) {
  return Boolean(
    scorecard.sdkVersion &&
      scorecard.latestSdkVersion &&
      scorecard.sdkVersion !== scorecard.latestSdkVersion,
  );
}

function formatPercent(value: ConsumerScorecard["quotaUsagePercent"]) {
  if (value === undefined) return "unknown";
  return typeof value === "number" ? `${value}%` : value;
}

function serviceDetailHref(serviceId: string, section: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=${encodeURIComponent(section)}`;
}
