"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EyeIcon, ShieldCheckIcon } from "lucide-react";
import {
  currentUtcDateInput,
  currentUtcPartition,
  dateInputToPartition,
} from "@/components/data-pipeline-dashboard/data-pipeline-date";
import { useDataPipelineDashboardQueries } from "@/components/data-pipeline-dashboard/data-pipeline-dashboard-queries";
import { buildNorthStarSummary } from "@/lib/data-pipeline/north-star-summary";
import type {
  PipelineAthenaCostRow,
  PipelineDecisionSignalRow,
  PipelineGatewayDecisionRow,
  PipelineQualityRow,
} from "@/lib/schemas";
import { toPipelineLane, type RuntimeEnvironment } from "@/lib/environment-names";
import type { NorthStarBiConfig } from "@/lib/server/north-star-bi-config";
import { BiEmbedPanel } from "@/components/bi-embed-panel";
import { BiAnalyticsPanel } from "@/components/bi-analytics-panel";
import { DataPipelineCostPanel } from "@/components/data-pipeline-cost-panel";
import { DataPipelineGovernancePanel } from "@/components/data-pipeline-governance-panel";
import { DataPipelineHealthPanel } from "@/components/data-pipeline-health-panel";
import { EmptyDataState } from "@/components/query-state";
import { NorthStarSummaryPanel } from "@/components/north-star-summary-panel";
import { RawToSilverRunPanel } from "@/components/raw-to-silver-run-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

export function DataPipelineDashboardClient({
  biConfig,
}: {
  biConfig: NorthStarBiConfig;
}) {
  const [environment, setEnvironment] =
    useState<RuntimeEnvironment>("test");
  const [partitionValue, setPartitionValue] = useState(currentUtcDateInput());
  const [windowDays, setWindowDays] = useState(30);
  const [selectedActionId, setSelectedActionId] = useState<string>();
  const partition = dateInputToPartition(partitionValue);
  const runPartition = partition ?? currentUtcPartition();
  const partitionKey = partition
    ? `${partition.year}-${partition.month}-${partition.day}`
    : "current";
  const {
    healthQuery,
    qualityQuery,
    sharedServiceUsageQuery,
    gatewayDecisionQuery,
    costQuery,
    decisionSignalQuery,
  } = useDataPipelineDashboardQueries({
    environment,
    partition,
    partitionKey,
    windowDays,
  });

  const healthRows = useMemo(
    () => healthQuery.data ?? [],
    [healthQuery.data],
  );
  const qualityRows = useMemo(
    () => qualityQuery.data ?? [],
    [qualityQuery.data],
  );
  const sharedServiceUsageRows = useMemo(
    () => sharedServiceUsageQuery.data ?? [],
    [sharedServiceUsageQuery.data],
  );
  const gatewayDecisionRows = useMemo(
    () => gatewayDecisionQuery.data ?? [],
    [gatewayDecisionQuery.data],
  );
  const costRows = useMemo(() => costQuery.data ?? [], [costQuery.data]);
  const decisionSignalRows = useMemo(
    () => decisionSignalQuery.data ?? [],
    [decisionSignalQuery.data],
  );

  const northStarSummary = useMemo(
    () =>
      buildNorthStarSummary({
        healthRows,
        qualityRows,
        sharedServiceUsageRows,
        gatewayDecisionRows,
        costRows,
        decisionSignalRows,
        biEnabled: biConfig.enabled,
      }),
    [
      healthRows,
      qualityRows,
      sharedServiceUsageRows,
      gatewayDecisionRows,
      costRows,
      decisionSignalRows,
      biConfig.enabled,
    ],
  );

  const pipelineActions = useMemo(
    () =>
      buildPipelineActions({
        qualityRows,
        gatewayDecisionRows,
        decisionSignalRows,
        costRows,
      }),
    [qualityRows, gatewayDecisionRows, decisionSignalRows, costRows],
  );
  const selectedAction =
    pipelineActions.find((action) => action.id === selectedActionId) ??
    pipelineActions[0];

  const governanceLoading =
    qualityQuery.isLoading ||
    qualityQuery.isFetching ||
    sharedServiceUsageQuery.isLoading ||
    sharedServiceUsageQuery.isFetching ||
    gatewayDecisionQuery.isLoading ||
    gatewayDecisionQuery.isFetching ||
    decisionSignalQuery.isLoading ||
    decisionSignalQuery.isFetching;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={environment === "test" ? "default" : "outline"}
          onClick={() => setEnvironment("test")}
        >
          Test
        </Button>
        <Button
          type="button"
          variant={environment === "live" ? "default" : "outline"}
          onClick={() => setEnvironment("live")}
        >
          Live
        </Button>
        <input
          aria-label="Pipeline partition date"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          type="date"
          value={partitionValue}
          onChange={(event) => setPartitionValue(event.target.value)}
        />
        <div
          aria-label="Governance window"
          className="inline-flex h-9 overflow-hidden rounded-md border border-input"
          role="group"
        >
          <Button
            type="button"
            variant={windowDays === 1 ? "default" : "ghost"}
            className="h-9 rounded-none"
            aria-pressed={windowDays === 1}
            onClick={() => setWindowDays(1)}
          >
            1 day
          </Button>
          <Button
            type="button"
            variant={windowDays === 30 ? "default" : "ghost"}
            className="h-9 rounded-none"
            aria-pressed={windowDays === 30}
            onClick={() => setWindowDays(30)}
          >
            30 days
          </Button>
        </div>
        {environment === "test" && windowDays > 1 ? (
          <span className="text-xs text-muted-foreground">
            Synthetic test window
          </span>
        ) : null}
      </div>

      <NorthStarSummaryPanel summary={northStarSummary} />

      <PipelineActionReview
        actions={pipelineActions}
        selectedAction={selectedAction}
        onSelectAction={setSelectedActionId}
      />

      <Tabs defaultValue="traceability">
        <TabsList className="flex w-full flex-wrap justify-start" variant="line">
          <TabsTrigger value="traceability">Traceability</TabsTrigger>
          <TabsTrigger value="governance">Governance</TabsTrigger>
          <TabsTrigger value="cost">Cost</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="bi">BI</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>
        <TabsContent value="traceability" className="mt-4">
          <DataPipelineHealthPanel
            rows={healthRows}
            loading={healthQuery.isLoading || healthQuery.isFetching}
          />
        </TabsContent>
        <TabsContent value="governance" className="mt-4">
          <DataPipelineGovernancePanel
            qualityRows={qualityRows}
            sharedServiceUsageRows={sharedServiceUsageRows}
            gatewayDecisionRows={gatewayDecisionRows}
            decisionSignalRows={decisionSignalRows}
            loading={governanceLoading}
          />
        </TabsContent>
        <TabsContent value="cost" className="mt-4">
          <DataPipelineCostPanel
            rows={costRows}
            loading={costQuery.isLoading || costQuery.isFetching}
          />
        </TabsContent>
        <TabsContent value="analytics" className="mt-4">
          <BiAnalyticsPanel
            healthRows={healthRows}
            qualityRows={qualityRows}
            sharedServiceUsageRows={sharedServiceUsageRows}
            gatewayDecisionRows={gatewayDecisionRows}
            costRows={costRows}
            decisionSignalRows={decisionSignalRows}
          />
        </TabsContent>
        <TabsContent value="bi" className="mt-4">
          <BiEmbedPanel config={biConfig} />
        </TabsContent>
        <TabsContent value="runs" className="mt-4">
          <RawToSilverRunPanel
            environment={toPipelineLane(environment)}
            partition={runPartition}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type PipelineActionSeverity = "critical" | "warning" | "info";

type PipelineAction = {
  id: string;
  label: string;
  source: string;
  owner: string;
  severity: PipelineActionSeverity;
  evidence: string;
  nextStep: {
    label: string;
    href: string;
  };
  priority: number;
};

function PipelineActionReview({
  actions,
  selectedAction,
  onSelectAction,
}: {
  actions: PipelineAction[];
  selectedAction?: PipelineAction;
  onSelectAction: (actionId: string) => void;
}) {
  if (!actions.length) {
    return (
      <EmptyDataState
        title="No pipeline actions need attention"
        description="No event-quality, gateway-denial, decision-signal, or cost feedback needs action in this window."
        recoverySteps={[
          {
            label: "Verify raw-to-silver telemetry",
            description:
              "Confirm the selected partition has health and quality rows before treating the queue as clear.",
          },
          {
            label: "Check gateway decision export",
            description:
              "Confirm gateway allow/deny decisions are exported for the selected environment.",
          },
          {
            label: "Refresh the partition window",
            description:
              "Adjust the date or governance window after new pipeline observations arrive.",
          },
        ]}
      />
    );
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(21rem,0.8fr)]">
      <div className="overflow-hidden rounded-lg border">
        <div className="hidden grid-cols-[minmax(10rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Action</span>
          <span>Severity</span>
          <span>Evidence</span>
          <span className="sr-only">Inspect</span>
        </div>
        <div className="divide-y">
          {actions.map((action) => (
            <PipelineActionRow
              key={action.id}
              action={action}
              selected={action.id === selectedAction?.id}
              onSelect={() => onSelectAction(action.id)}
            />
          ))}
        </div>
      </div>
      {selectedAction ? <PipelineActionDetail action={selectedAction} /> : null}
    </section>
  );
}

function PipelineActionRow({
  action,
  selected,
  onSelect,
}: {
  action: PipelineAction;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-3 md:grid-cols-[minmax(10rem,0.8fr)_8rem_minmax(0,1fr)_2.25rem] md:items-start">
      <div className="min-w-0">
        <div className="truncate font-medium">{action.label}</div>
        <div className="truncate text-xs text-muted-foreground">
          {action.owner} / {action.source}
        </div>
      </div>
      <div className="col-start-1 md:col-auto">
        <PipelineSeverityBadge severity={action.severity} />
      </div>
      <div className="col-start-1 min-w-0 break-words text-sm text-muted-foreground md:col-auto">
        {action.evidence}
      </div>
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Inspect pipeline action ${action.source}`}
        title={`Inspect pipeline action ${action.source}`}
        onClick={onSelect}
        className="col-start-2 row-start-1 inline-flex h-7 w-7 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted aria-pressed:text-foreground md:col-auto md:row-auto"
      >
        <EyeIcon data-icon="inline-end" />
      </button>
    </div>
  );
}

function PipelineActionDetail({ action }: { action: PipelineAction }) {
  return (
    <aside
      aria-label="Selected pipeline action detail"
      className="order-first rounded-lg border bg-muted/10 p-4 xl:order-none"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Selected pipeline action</div>
          <div className="mt-1 truncate text-base font-medium">
            {action.label}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {action.owner} / {action.source}
          </div>
        </div>
        <PipelineSeverityBadge severity={action.severity} />
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">Evidence</div>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {action.evidence}
        </p>
      </div>

      <div className="mt-4 border-t pt-4">
        <div className="text-xs font-medium text-muted-foreground">
          Next action
        </div>
        <Link
          href={action.nextStep.href}
          className="mt-1 inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
        >
          {action.nextStep.label}
          <ShieldCheckIcon data-icon="inline-end" />
        </Link>
      </div>
    </aside>
  );
}

function PipelineSeverityBadge({
  severity,
}: {
  severity: PipelineActionSeverity;
}) {
  if (severity === "critical") {
    return <Badge variant="destructive">critical</Badge>;
  }
  if (severity === "warning") return <Badge variant="secondary">warning</Badge>;
  return <Badge variant="outline">info</Badge>;
}

function buildPipelineActions({
  qualityRows,
  gatewayDecisionRows,
  decisionSignalRows,
  costRows,
}: {
  qualityRows: PipelineQualityRow[];
  gatewayDecisionRows: PipelineGatewayDecisionRow[];
  decisionSignalRows: PipelineDecisionSignalRow[];
  costRows: PipelineAthenaCostRow[];
}) {
  const qualityActions = qualityRows
    .filter((row) => row.qualityErrorCount > 0)
    .map((row): PipelineAction => {
      const serviceId = row.sourceServiceId ?? row.tribeId;
      const latestError = row.latestQualityError
        ? ` Latest error: ${row.latestQualityError}.`
        : "";
      return {
        id: [
          "quality",
          row.environment,
          row.tribeId,
          row.sourceServiceId ?? "unknown",
          row.eventType,
          row.eventDay,
        ].join(":"),
        label: "Resolve event quality errors",
        source: "Event quality",
        owner: serviceId,
        severity: "critical",
        evidence: `${formatCount(row.qualityErrorCount, "quality error")} need correction for ${row.eventType}.${latestError}`,
        nextStep: {
          label: "Open service pipeline",
          href: servicePipelineHref(serviceId),
        },
        priority: 0,
      };
    });

  const gatewayActions = gatewayDecisionRows
    .filter((row) => row.deniedCount > 0)
    .map((row): PipelineAction => {
      const serviceId =
        row.sourceServiceId ?? row.targetServiceId ?? row.tribeId;
      return {
        id: [
          "gateway",
          row.environment,
          row.tribeId,
          row.sourceServiceId ?? "unknown-source",
          row.targetServiceId ?? "unknown-target",
          row.scope ?? "unknown-scope",
          row.eventDay,
        ].join(":"),
        label: "Review gateway denials",
        source: "Gateway denials",
        owner: serviceId,
        severity: row.deniedCount >= 10 ? "critical" : "warning",
        evidence: `${row.deniedCount} gateway decisions were denied for ${row.scope ?? "unknown scope"}.`,
        nextStep: {
          label: "Open service pipeline",
          href: servicePipelineHref(serviceId),
        },
        priority: 1,
      };
    });

  const decisionActions = decisionSignalRows
    .filter((row) => row.status === "open" || row.status === "blocked")
    .map((row): PipelineAction => {
      const serviceId = row.sourceServiceId ?? row.tribeId;
      return {
        id: `decision:${row.signalId}`,
        label: "Review decision signal",
        source: "Decision signal",
        owner: serviceId,
        severity: row.severity === "high" ? "critical" : "warning",
        evidence: `${row.metricName} observed ${row.observedValue} against expected ${row.expectedValue}. ${row.recommendation}`,
        nextStep: {
          label: "Open service pipeline",
          href: servicePipelineHref(serviceId),
        },
        priority: 2,
      };
    });

  const costActions = costRows
    .filter((row) => row.estimatedCostUsd >= 1)
    .map((row): PipelineAction => ({
      id: [
        "cost",
        row.environment,
        row.workgroup,
        row.resultPurpose,
        row.eventDay,
      ].join(":"),
      label: "Review Athena scan cost",
      source: "Cost",
      owner: row.workgroup,
      severity: row.estimatedCostUsd >= 10 ? "critical" : "warning",
      evidence: `${row.queryCount} queries scanned ${formatBytes(row.bytesScanned)} for ${formatCurrency(row.estimatedCostUsd)}.`,
      nextStep: {
        label: "Open cost view",
        href: "/data-pipeline",
      },
      priority: 3,
    }));

  return [
    ...qualityActions,
    ...gatewayActions,
    ...decisionActions,
    ...costActions,
  ].sort(comparePipelineActions);
}

function comparePipelineActions(left: PipelineAction, right: PipelineAction) {
  const severityDelta =
    severityRank(left.severity) - severityRank(right.severity);
  if (severityDelta !== 0) return severityDelta;
  const priorityDelta = left.priority - right.priority;
  if (priorityDelta !== 0) return priorityDelta;
  return left.label.localeCompare(right.label);
}

function severityRank(severity: PipelineActionSeverity) {
  if (severity === "critical") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function servicePipelineHref(serviceId: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=pipeline`;
}

function formatCount(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function formatBytes(bytes: number) {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}
