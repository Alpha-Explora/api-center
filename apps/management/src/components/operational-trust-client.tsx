import Link from "next/link";
import { useState } from "react";
import { EyeIcon, ShieldCheckIcon } from "lucide-react";
import { ConsumerScorecardPanel } from "./consumer-scorecard-panel";
import { EmergencyControlWorkflow } from "./emergency-control-workflow";
import { GovernanceDriftPanel } from "./governance-drift-panel";
import { PromotionEvidencePanel } from "./promotion-evidence-panel";
import { RuntimeDependencyMapPanel } from "./runtime-dependency-map-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { OperationalTrustUnavailableSection } from "@/lib/api-center-client";

type DriftItem = {
  severity: "warning" | "critical";
  resourceType: string;
  resourceId: string;
  ownerTribeId: string;
  message: string;
};

type DependencyEdge = { from: string; to: string; type: string };

type EvidenceSection = {
  key: string;
  status: "pass" | "fail";
  data?: unknown;
};

type Scorecard = {
  ownerTribeId: string;
  status: string;
  findings: string[];
};

type TrustSignal = {
  id: string;
  label: string;
  source: "Governance drift" | "Promotion evidence" | "Consumer scorecard";
  ownerTribeId?: string;
  severity: "critical" | "warning" | "info";
  evidence: string;
  action: {
    label: string;
    href: string;
  };
};

export function OperationalTrustClient({
  driftItems,
  dependencyEdges,
  evidenceSections,
  scorecards,
  unavailableSections = [],
}: {
  driftItems: DriftItem[];
  dependencyEdges: DependencyEdge[];
  evidenceSections: EvidenceSection[];
  scorecards: Scorecard[];
  unavailableSections?: OperationalTrustUnavailableSection[];
}) {
  const [selectedSignalId, setSelectedSignalId] = useState<string>();
  const trustSignals = buildTrustSignals({
    driftItems,
    evidenceSections,
    scorecards,
  });
  const selectedSignal =
    trustSignals.find((signal) => signal.id === selectedSignalId) ??
    trustSignals[0];

  return (
    <div className="space-y-6">
      <OperationalTrustReview
        signals={trustSignals}
        selectedSignal={selectedSignal}
        onSelectSignal={setSelectedSignalId}
      />
      <OperationalTrustUnavailableNotice sections={unavailableSections} />
      <EmergencyControlWorkflow />
      <GovernanceDriftPanel items={driftItems} />
      <RuntimeDependencyMapPanel edges={dependencyEdges} />
      <PromotionEvidencePanel sections={evidenceSections} />
      <ConsumerScorecardPanel scorecards={scorecards} />
    </div>
  );
}

function OperationalTrustUnavailableNotice({
  sections,
}: {
  sections: OperationalTrustUnavailableSection[];
}) {
  if (!sections.length) return null;

  return (
    <Alert>
      <AlertTitle>Some trust data could not be loaded</AlertTitle>
      <AlertDescription>
        <ul className="mt-2 grid gap-1">
          {sections.map((section) => (
            <li key={section.key}>
              <span className="font-medium">
                {section.label} unavailable
              </span>
              <span className="text-muted-foreground">
                {" "}
                {section.reason}
              </span>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function OperationalTrustReview({
  signals,
  selectedSignal,
  onSelectSignal,
}: {
  signals: TrustSignal[];
  selectedSignal?: TrustSignal;
  onSelectSignal: (signalId: string) => void;
}) {
  if (!signals.length) {
    return (
      <section className="rounded-lg border bg-muted/10 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheckIcon data-icon="inline-start" />
          Trust review
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          No operational trust signals need review.
        </p>
      </section>
    );
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.8fr)]">
      <div className="overflow-hidden rounded-lg border">
        <div className="hidden grid-cols-[minmax(11rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Signal</span>
          <span>Severity</span>
          <span>Evidence</span>
          <span className="sr-only">Inspect</span>
        </div>
        <div className="divide-y">
          {signals.map((signal) => (
            <TrustSignalRow
              key={signal.id}
              signal={signal}
              selected={signal.id === selectedSignal?.id}
              onSelect={() => onSelectSignal(signal.id)}
            />
          ))}
        </div>
      </div>
      {selectedSignal ? <TrustSignalDetail signal={selectedSignal} /> : null}
    </section>
  );
}

function TrustSignalRow({
  signal,
  selected,
  onSelect,
}: {
  signal: TrustSignal;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 md:grid-cols-[minmax(11rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] md:items-start">
      <div className="min-w-0">
        <div className="truncate font-medium">{signal.label}</div>
        <div className="truncate text-xs text-muted-foreground">
          {signal.source}
          {signal.ownerTribeId ? ` / ${signal.ownerTribeId}` : ""}
        </div>
      </div>
      <div className="col-start-1 md:col-auto">
        <Badge variant={signal.severity === "info" ? "secondary" : "destructive"}>
          {signal.severity}
        </Badge>
      </div>
      <div className="col-start-1 min-w-0 break-words text-sm text-muted-foreground md:col-auto">
        {signal.evidence}
      </div>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect operational trust signal ${signal.label}`}
        title={`Inspect operational trust signal ${signal.label}`}
        onClick={onSelect}
        className="col-start-2 row-start-1 inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground md:col-auto md:row-auto"
      >
        <EyeIcon data-icon="inline-end" />
      </button>
    </div>
  );
}

function TrustSignalDetail({ signal }: { signal: TrustSignal }) {
  return (
    <aside
      aria-label="Selected operational trust detail"
      className="order-first rounded-lg border bg-muted/10 p-4 xl:order-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Selected trust signal</div>
          <div className="mt-1 truncate text-base font-medium">
            {signal.label}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {signal.source}
            {signal.ownerTribeId ? ` for ${signal.ownerTribeId}` : ""}
          </div>
        </div>
        <Badge variant={signal.severity === "info" ? "secondary" : "destructive"}>
          {signal.severity}
        </Badge>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">Evidence</div>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {signal.evidence}
        </p>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">
          Next action
        </div>
        <Link
          href={signal.action.href}
          className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          {signal.action.label}
          <ShieldCheckIcon data-icon="inline-end" />
        </Link>
      </div>
    </aside>
  );
}

function buildTrustSignals({
  driftItems,
  evidenceSections,
  scorecards,
}: {
  driftItems: DriftItem[];
  evidenceSections: EvidenceSection[];
  scorecards: Scorecard[];
}) {
  const signals: TrustSignal[] = [
    ...driftItems.map((item) => ({
      id: `drift:${item.resourceType}:${item.resourceId}`,
      label: `Governance drift ${item.resourceId}`,
      source: "Governance drift" as const,
      ownerTribeId: item.ownerTribeId,
      severity: item.severity,
      evidence: item.message,
      action: ownerServiceDetailAction(item.ownerTribeId),
    })),
    ...evidenceSections
      .filter((section) => section.status === "fail")
      .map((section) => {
        const serviceId = evidenceServiceId(section.data);

        return {
          id: `evidence:${section.key}`,
          label: `Promotion evidence ${section.key}`,
          source: "Promotion evidence" as const,
          ownerTribeId: serviceId,
          severity: "critical" as const,
          evidence: `${section.key} evidence is failing.`,
          action: {
            label: "Open promotion gates.",
            href: serviceId ? serviceGovernanceHref(serviceId) : "/promotions",
          },
        };
      }),
    ...scorecards
      .filter((scorecard) => scorecard.status !== "healthy")
      .map((scorecard) => ({
        id: `scorecard:${scorecard.ownerTribeId}`,
        label: `Consumer scorecard ${scorecard.ownerTribeId}`,
        source: "Consumer scorecard" as const,
        ownerTribeId: scorecard.ownerTribeId,
        severity: "warning" as const,
        evidence: scorecard.findings.join(" ") || `${scorecard.status} scorecard status.`,
        action: ownerServiceDetailAction(scorecard.ownerTribeId),
      })),
  ];

  return signals.sort(compareTrustSignals);
}

function ownerServiceDetailAction(ownerTribeId: string) {
  return {
    label: `Open ${ownerTribeId} service detail.`,
    href: serviceGovernanceHref(ownerTribeId),
  };
}

function evidenceServiceId(data: unknown) {
  if (!data || typeof data !== "object") return undefined;

  const {
    serviceId,
    ownerTribeId,
  } = data as { serviceId?: unknown; ownerTribeId?: unknown };
  const candidate = serviceId ?? ownerTribeId;

  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : undefined;
}

function serviceGovernanceHref(serviceId: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=governance`;
}

function compareTrustSignals(left: TrustSignal, right: TrustSignal) {
  const rankDelta = trustSignalRank(left) - trustSignalRank(right);
  if (rankDelta !== 0) return rankDelta;
  return left.id.localeCompare(right.id);
}

function trustSignalRank(signal: TrustSignal) {
  if (signal.severity === "critical") return 0;
  if (signal.severity === "warning") return 1;
  return 2;
}
