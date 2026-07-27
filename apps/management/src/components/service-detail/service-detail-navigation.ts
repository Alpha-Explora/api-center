export const detailSections = [
  {
    value: "summary",
    label: "Summary",
    description: "Current posture and priority issue",
  },
  {
    value: "health",
    label: "Health",
    description: "Runtime checks and service ownership",
  },
  {
    value: "dependencies",
    label: "Dependencies",
    description: "Consumes, consumers, and broken links",
  },
  {
    value: "quotas",
    label: "Quotas",
    description: "Consumption policy and pressure",
  },
  {
    value: "pipeline",
    label: "Pipeline",
    description: "Event ingestion and data quality",
  },
  {
    value: "governance",
    label: "Governance",
    description: "Promotion readiness and trust posture",
  },
  {
    value: "evidence",
    label: "Evidence",
    description: "Timeline, mapping, and audit trail",
  },
  {
    value: "actions",
    label: "Actions",
    description: "Safe operational changes",
  },
] as const;

export type DetailSection = (typeof detailSections)[number]["value"];

export function normalizeSection(value?: string): DetailSection {
  if (detailSections.some((section) => section.value === value)) {
    return value as DetailSection;
  }

  if (value === "observability") return "pipeline";
  if (value === "lifecycle" || value === "developer") return "actions";

  return "summary";
}
