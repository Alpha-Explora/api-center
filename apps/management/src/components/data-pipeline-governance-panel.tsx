"use client";

import type React from "react";
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
import type {
  PipelineGatewayDecisionRow,
  PipelineDecisionSignalRow,
  PipelineQualityRow,
  PipelineSharedServiceUsageRow,
} from "@/lib/schemas";

export function DataPipelineGovernancePanel({
  qualityRows = [],
  sharedServiceUsageRows = [],
  gatewayDecisionRows = [],
  decisionSignalRows = [],
  loading = false,
}: {
  qualityRows?: PipelineQualityRow[];
  sharedServiceUsageRows?: PipelineSharedServiceUsageRow[];
  gatewayDecisionRows?: PipelineGatewayDecisionRow[];
  decisionSignalRows?: PipelineDecisionSignalRow[];
  loading?: boolean;
}) {
  const hasGovernanceRows =
    qualityRows.length > 0 ||
    sharedServiceUsageRows.length > 0 ||
    gatewayDecisionRows.length > 0 ||
    decisionSignalRows.length > 0;
  const qualityErrorCount = qualityRows.reduce(
    (total, row) => total + row.qualityErrorCount,
    0,
  );
  const deniedCount = gatewayDecisionRows.reduce(
    (total, row) => total + row.deniedCount,
    0,
  );
  const highSignalCount = decisionSignalRows.filter(
    (row) => row.severity === "high",
  ).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Governance signals</CardTitle>
        <CardDescription>
          Curated quality, shared-service, and gateway-decision metrics.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {loading ? (
          <Alert>
            <LoaderCircleIcon data-icon="inline-start" className="animate-spin" />
            <AlertTitle>Loading governance metrics</AlertTitle>
            <AlertDescription>
              Reading APICenter Gold governance outputs.
            </AlertDescription>
          </Alert>
        ) : null}

        {!loading && !hasGovernanceRows ? (
          <Alert>
            <AlertTitle>No governance rows yet</AlertTitle>
            <AlertDescription>
              Quality, shared-service, and gateway-decision rows will appear after
              APICenter has matching curated Gold data.
            </AlertDescription>
          </Alert>
        ) : null}

        {!loading && (qualityErrorCount > 0 || deniedCount > 0 || highSignalCount > 0) ? (
          <Alert variant={qualityErrorCount > 0 ? "destructive" : "default"}>
            <AlertTriangleIcon data-icon="inline-start" />
            <AlertTitle>Review needed</AlertTitle>
            <AlertDescription>
              {qualityErrorCount} quality error(s) and {deniedCount} denied gateway
              decision(s) are present in this view. {highSignalCount} high-severity
              decision signal(s) need review.
            </AlertDescription>
          </Alert>
        ) : null}

        {decisionSignalRows.length ? (
          <MetricSection title="Decision signals">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Severity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Tribe</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Metric</TableHead>
                  <TableHead>Observed</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Recommendation</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {decisionSignalRows.map((row) => (
                  <TableRow key={row.signalId}>
                    <TableCell>
                      <SignalSeverityBadge severity={row.severity} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.signalType}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.tribeId}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.sourceServiceId ?? "Platform"}
                    </TableCell>
                    <TableCell>{row.metricName}</TableCell>
                    <TableCell>
                      {row.observedValue} / {row.expectedValue}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.evidenceQueryId ?? "No query"}
                    </TableCell>
                    <TableCell>
                      <SignalStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="max-w-80 text-sm">
                      {row.recommendation}
                    </TableCell>
                    <TableCell>
                      <DataPipelineFeedbackActions
                        environment={row.environment}
                        targetType="signal"
                        targetId={row.signalId}
                        ownerTribeId={row.tribeId}
                        evidenceLink={row.evidenceQueryId}
                        actions={PIPELINE_FEEDBACK_ACTION_GROUPS.decision}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </MetricSection>
        ) : null}

        {qualityRows.length ? (
          <MetricSection title="Event quality">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tribe</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Day</TableHead>
                  <TableHead>Valid</TableHead>
                  <TableHead>Invalid</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {qualityRows.map((row) => (
                  <TableRow
                    key={[
                      row.environment,
                      row.tribeId,
                      row.sourceServiceId ?? "unknown",
                      row.eventType,
                      row.eventDay,
                    ].join(":")}
                  >
                    <TableCell className="font-mono text-xs">{row.tribeId}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.sourceServiceId ?? "Unknown"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.eventType}</TableCell>
                    <TableCell>{row.eventDay}</TableCell>
                    <TableCell>{row.validEventCount}</TableCell>
                    <TableCell>{row.invalidEventCount}</TableCell>
                    <TableCell>
                      <QualityBadge errorCount={row.qualityErrorCount} />
                    </TableCell>
                    <TableCell>
                      <DataPipelineFeedbackActions
                        environment={row.environment}
                        targetType="event"
                        targetId={row.eventType}
                        ownerTribeId={row.tribeId}
                        actions={PIPELINE_FEEDBACK_ACTION_GROUPS.quality}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </MetricSection>
        ) : null}

        {gatewayDecisionRows.length ? (
          <MetricSection title="Gateway decisions">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tribe</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Scope</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gatewayDecisionRows.map((row) => (
                  <TableRow
                    key={[
                      row.environment,
                      row.tribeId,
                      row.sourceServiceId ?? "unknown-source",
                      row.targetServiceId ?? "unknown-target",
                      row.scope ?? "unknown-scope",
                      row.decision,
                      row.eventDay,
                    ].join(":")}
                  >
                    <TableCell className="font-mono text-xs">{row.tribeId}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.sourceServiceId ?? "Unknown"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.targetServiceId ?? "Unknown"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.scope ?? "Unknown"}
                    </TableCell>
                    <TableCell>
                      <DecisionBadge decision={row.decision} />
                    </TableCell>
                    <TableCell>{row.decisionCount}</TableCell>
                    <TableCell>
                      <DataPipelineFeedbackActions
                        environment={row.environment}
                        targetType="service"
                        targetId={
                          row.targetServiceId ??
                          row.sourceServiceId ??
                          row.tribeId
                        }
                        ownerTribeId={row.tribeId}
                        actions={PIPELINE_FEEDBACK_ACTION_GROUPS.gateway}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </MetricSection>
        ) : null}

        {sharedServiceUsageRows.length ? (
          <MetricSection title="Shared-service usage">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tribe</TableHead>
                  <TableHead>Shared service</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Calls</TableHead>
                  <TableHead>Failures</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sharedServiceUsageRows.map((row) => (
                  <TableRow
                    key={[
                      row.environment,
                      row.tribeId,
                      row.sharedServiceId,
                      row.provider,
                      row.providerStatus,
                      row.eventDay,
                    ].join(":")}
                  >
                    <TableCell className="font-mono text-xs">{row.tribeId}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.sharedServiceId}
                    </TableCell>
                    <TableCell>{row.provider}</TableCell>
                    <TableCell>{row.providerStatus}</TableCell>
                    <TableCell>{row.eventCount}</TableCell>
                    <TableCell>{row.failureCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </MetricSection>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MetricSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="overflow-hidden rounded-lg border">{children}</div>
    </section>
  );
}

function QualityBadge({ errorCount }: { errorCount: number }) {
  if (errorCount > 0) {
    return <Badge variant="destructive">{errorCount} error(s)</Badge>;
  }

  return (
    <Badge className="bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]">
      <CheckCircle2Icon data-icon="inline-start" />
      Valid
    </Badge>
  );
}

function DecisionBadge({
  decision,
}: {
  decision: PipelineGatewayDecisionRow["decision"];
}) {
  if (decision === "allowed") {
    return (
      <Badge className="bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]">
        Allowed
      </Badge>
    );
  }

  if (decision === "denied") {
    return <Badge variant="destructive">Denied</Badge>;
  }

  return <Badge variant="secondary">Unknown</Badge>;
}

function SignalSeverityBadge({
  severity,
}: {
  severity: PipelineDecisionSignalRow["severity"];
}) {
  if (severity === "high") return <Badge variant="destructive">High</Badge>;
  if (severity === "medium") return <Badge variant="secondary">Medium</Badge>;
  return <Badge variant="outline">Low</Badge>;
}

function SignalStatusBadge({
  status,
}: {
  status: PipelineDecisionSignalRow["status"];
}) {
  const label = status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  if (status === "blocked") return <Badge variant="destructive">{label}</Badge>;
  if (status === "false_positive") {
    return <Badge variant="secondary">{label}</Badge>;
  }
  if (status === "acknowledged") {
    return (
      <Badge className="bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]">
        {label}
      </Badge>
    );
  }

  return <Badge variant="outline">{label}</Badge>;
}
