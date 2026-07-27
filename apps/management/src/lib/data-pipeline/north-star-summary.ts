import type {
  PipelineAthenaCostRow,
  PipelineDecisionSignalRow,
  PipelineGatewayDecisionRow,
  PipelineHealthRow,
  PipelineQualityRow,
  PipelineSharedServiceUsageRow,
} from "@/lib/schemas";

export type NorthStarQuestionKey =
  | "ownership"
  | "gateway"
  | "export"
  | "quality"
  | "cost"
  | "visualization";

export type NorthStarStatus = "complete" | "warning" | "missing";

export type NorthStarQuestion = {
  key: NorthStarQuestionKey;
  label: string;
  answer: string;
  status: NorthStarStatus;
  evidenceCount: number;
};

export type NorthStarSummary = {
  status: NorthStarStatus;
  answer: string;
  metrics: {
    totalEvents: number;
    uniqueTribes: number;
    uniqueSourceServices: number;
    allowedGatewayDecisions: number;
    deniedGatewayDecisions: number;
    qualityErrors: number;
    sharedServiceFailures: number;
    estimatedCostUsd: number;
    openDecisionSignals: number;
    biConfigured: boolean;
  };
  questions: NorthStarQuestion[];
};

export function buildNorthStarSummary(input: {
  healthRows: PipelineHealthRow[];
  qualityRows: PipelineQualityRow[];
  sharedServiceUsageRows: PipelineSharedServiceUsageRow[];
  gatewayDecisionRows: PipelineGatewayDecisionRow[];
  costRows: PipelineAthenaCostRow[];
  decisionSignalRows: PipelineDecisionSignalRow[];
  biEnabled: boolean;
}): NorthStarSummary {
  const totalEvents = sum(input.healthRows, (row) => row.eventCount);
  const uniqueTribes = new Set([
    ...input.healthRows.map((row) => row.tribeId),
    ...input.gatewayDecisionRows.map((row) => row.tribeId),
    ...input.qualityRows.map((row) => row.tribeId),
  ]).size;
  const uniqueSourceServices = new Set(
    input.healthRows
      .map((row) => row.sourceServiceId)
      .filter((value): value is string => Boolean(value)),
  ).size;
  const allowedGatewayDecisions = sum(
    input.gatewayDecisionRows,
    (row) => row.allowedCount,
  );
  const deniedGatewayDecisions = sum(
    input.gatewayDecisionRows,
    (row) => row.deniedCount,
  );
  const qualityErrors = sum(input.qualityRows, (row) => row.qualityErrorCount);
  const sharedServiceFailures = sum(
    input.sharedServiceUsageRows,
    (row) => row.failureCount,
  );
  const estimatedCostUsd = roundCurrency(
    sum(input.costRows, (row) => row.estimatedCostUsd),
  );
  const openDecisionSignals = input.decisionSignalRows.filter(
    (row) => row.status === "open" || row.status === "blocked",
  ).length;

  const questions: NorthStarQuestion[] = [
    {
      key: "ownership",
      label: "Who produced what?",
      answer:
        uniqueTribes > 0
          ? `${uniqueTribes} tribe(s), ${uniqueSourceServices} source service(s), and ${totalEvents} event(s) are visible in curated rows.`
          : "No curated tribe or service attribution is visible for this partition.",
      status: uniqueTribes > 0 && totalEvents > 0 ? "complete" : "missing",
      evidenceCount: input.healthRows.length,
    },
    {
      key: "gateway",
      label: "Was it allowed?",
      answer:
        input.gatewayDecisionRows.length > 0
          ? `${allowedGatewayDecisions} allowed and ${deniedGatewayDecisions} denied gateway decision(s) are visible.`
          : "No gateway decision rows are visible for this partition.",
      status:
        input.gatewayDecisionRows.length === 0
          ? "missing"
          : deniedGatewayDecisions > 0
            ? "warning"
            : "complete",
      evidenceCount: input.gatewayDecisionRows.length,
    },
    {
      key: "export",
      label: "Did events land and curate?",
      answer:
        input.healthRows.length > 0
          ? `${input.healthRows.length} pipeline-health row(s) show event arrival and curated Gold evidence.`
          : "No pipeline-health row is available for event landing or curation evidence.",
      status: input.healthRows.length > 0 ? "complete" : "missing",
      evidenceCount: input.healthRows.length,
    },
    {
      key: "quality",
      label: "Is the data usable?",
      answer:
        input.qualityRows.length > 0
          ? `${qualityErrors} quality error(s) and ${openDecisionSignals} open decision signal(s) need review.`
          : "No quality rows are visible for this partition.",
      status:
        input.qualityRows.length === 0
          ? "missing"
          : qualityErrors > 0 || openDecisionSignals > 0
            ? "warning"
            : "complete",
      evidenceCount: input.qualityRows.length + input.decisionSignalRows.length,
    },
    {
      key: "cost",
      label: "How much did it cost to query?",
      answer:
        input.costRows.length > 0
          ? `$${estimatedCostUsd.toFixed(2)} estimated Athena scan cost is visible for this partition.`
          : "No Athena query-cost telemetry is visible for this partition.",
      status: input.costRows.length > 0 ? "complete" : "missing",
      evidenceCount: input.costRows.length,
    },
    {
      key: "visualization",
      label: "Is the BI view connected?",
      answer: input.biEnabled
        ? "The governed BI dashboard is configured for this management environment."
        : "BI embed is not configured in this management environment.",
      status: input.biEnabled ? "complete" : "missing",
      evidenceCount: input.biEnabled ? 1 : 0,
    },
  ];

  const missingCount = questions.filter(
    (question) => question.status === "missing",
  ).length;
  const warningCount = questions.filter(
    (question) => question.status === "warning",
  ).length;
  const status: NorthStarStatus =
    totalEvents === 0 && missingCount === questions.length
      ? "missing"
      : warningCount > 0 || missingCount > 0
        ? "warning"
        : "complete";

  return {
    status,
    answer: northStarAnswer(status),
    metrics: {
      totalEvents,
      uniqueTribes,
      uniqueSourceServices,
      allowedGatewayDecisions,
      deniedGatewayDecisions,
      qualityErrors,
      sharedServiceFailures,
      estimatedCostUsd,
      openDecisionSignals,
      biConfigured: input.biEnabled,
    },
    questions,
  };
}

function northStarAnswer(status: NorthStarStatus) {
  if (status === "complete") {
    return "Traceable: this partition has native evidence for ownership, gateway decisions, export health, quality, cost, and visualization.";
  }

  if (status === "warning") {
    return "Partially traceable: curated evidence exists, but one or more supporting questions need review.";
  }

  return "Not enough curated evidence is available to answer the north-star question for this partition.";
}

function sum<T>(rows: T[], select: (row: T) => number | undefined) {
  return rows.reduce((total, row) => total + (select(row) ?? 0), 0);
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}
