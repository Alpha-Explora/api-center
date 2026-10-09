export type AppNavItem = {
  href: string;
  label: string;
  description: string;
  keywords?: string[];
};

export type AppNavGroup<TItem extends AppNavItem = AppNavItem> = {
  label: string;
  items: TItem[];
};

export type AppNavSearchResult<TItem extends AppNavItem = AppNavItem> = TItem & {
  groupLabel: string;
};

export const commandCenterNavGroups: AppNavGroup[] = [
  {
    label: "Command",
    items: [
      {
        href: "/dashboard",
        label: "Overview",
        description: "Review platform health, blockers, and next actions.",
        keywords: ["dashboard", "home", "command center", "health"],
      },
      {
        href: "/lifecycle",
        label: "Lifecycle",
        description: "Track service readiness from registry through runtime.",
        keywords: ["service status", "onboarding", "activation", "retire"],
      },
      {
        href: "/alerts",
        label: "Issues",
        description: "Triage active alerts and service-impacting incidents.",
        keywords: ["incidents", "errors", "blocked", "severity"],
      },
      {
        href: "/readiness",
        label: "Readiness",
        description: "Run platform readiness checks before changes.",
        keywords: ["health check", "preflight", "configuration"],
      },
    ],
  },
  {
    label: "Services",
    items: [
      {
        href: "/tribes",
        label: "Registry",
        description: "Find service ownership, status, and detail records.",
        keywords: ["services", "owners", "tribes", "service detail"],
      },
      {
        href: "/api-catalog",
        label: "API catalog",
        description: "Browse registered API products and exposed routes.",
        keywords: ["apis", "products", "endpoints", "contracts"],
      },
      {
        href: "/registration-requests",
        label: "Requests",
        description: "Approve or reject service registration requests.",
        keywords: ["approval", "approvals", "pending", "review"],
      },
      {
        href: "/dependencies",
        label: "Dependencies",
        description: "Inspect service-to-service dependency impact.",
        keywords: ["consumers", "providers", "shared dependency", "impact"],
      },
      {
        href: "/marketplace",
        label: "Marketplace",
        description: "Review available API products and adoption signals.",
        keywords: ["products", "catalog", "publish", "adoption"],
      },
      {
        href: "/developer-portal",
        label: "Developer portal",
        description: "Preview a tribe-safe onboarding and request packet.",
        keywords: ["portal", "sdk", "onboarding", "quota request"],
      },
      {
        href: "/shared-services",
        label: "Shared services",
        description: "Review shared-service providers and consumer usage.",
        keywords: ["providers", "consumers", "usage matrix", "platform services"],
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        href: "/quotas",
        label: "Quotas",
        description: "Set and review quota policy, rate limits, and usage.",
        keywords: ["rate limit", "rate limits", "throttle", "api calls"],
      },
      {
        href: "/reliability",
        label: "Reliability",
        description: "Inspect uptime, incidents, and runtime posture.",
        keywords: ["sla", "slo", "latency", "errors"],
      },
      {
        href: "/data-pipeline",
        label: "Pipeline",
        description: "Review gateway decisions, quality, and S3 pipeline health.",
        keywords: ["data", "s3", "raw to silver", "quality"],
      },
      {
        href: "/cost",
        label: "Cost",
        description: "Analyze provider usage and shared-service demand.",
        keywords: ["spend", "usage", "chargeback", "demand"],
      },
      {
        href: "/plans",
        label: "Plans",
        description: "Manage tribe plan tiers and assignment posture.",
        keywords: ["tiers", "subscription", "quota package", "assignments"],
      },
    ],
  },
  {
    label: "Governance",
    items: [
      {
        href: "/compliance",
        label: "Compliance",
        description: "Review scorecards, control gaps, and evidence status.",
        keywords: ["scorecard", "controls", "governance", "evidence"],
      },
      {
        href: "/audit",
        label: "Audit",
        description: "Search activity history and exported evidence.",
        keywords: ["events", "history", "actor", "export"],
      },
      {
        href: "/operational-trust",
        label: "Operational Trust",
        description: "Inspect trust signals across lifecycle and operations.",
        keywords: ["trust", "risk", "governance", "signals"],
      },
      {
        href: "/promotions",
        label: "Promotions",
        description: "Review environment promotion gates and approvals.",
        keywords: ["approval", "approvals", "release", "environment"],
      },
    ],
  },
  {
    label: "Tools",
    items: [
      {
        href: "/docs/consumer-runbook",
        label: "SDK runbook",
        description: "Open setup guidance for SDK adoption and request handling.",
        keywords: ["sdk setup", "consumer guide", "docs", "integration"],
      },
      {
        href: "/manifest-tools",
        label: "Manifest tools",
        description: "Validate, import, and export service manifests.",
        keywords: ["manifest", "json", "registry import", "validation"],
      },
      {
        href: "/smoke-tests",
        label: "Smoke tests",
        description: "Run shared-service smoke checks for a tribe.",
        keywords: ["test", "verification", "provider check", "consumer check"],
      },
      {
        href: "/settings",
        label: "Settings",
        description: "Review management environment and capability settings.",
        keywords: ["configuration", "environment", "session", "capabilities"],
      },
    ],
  },
];

export function getVisibleNavGroups<TItem extends AppNavItem>(
  groups: AppNavGroup<TItem>[],
  dataPipelineEnabled: boolean,
  platformAdmin = true,
) {
  const platformOnlyHrefs = new Set([
    "/readiness", "/data-pipeline", "/cost", "/compliance", "/smoke-tests", "/settings",
  ]);
  return groups.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (dataPipelineEnabled || item.href !== "/data-pipeline") &&
        (platformAdmin || !platformOnlyHrefs.has(item.href)),
    ),
  }));
}

export function getNavSearchResults<TItem extends AppNavItem>(
  groups: AppNavGroup<TItem>[],
  query: string,
  dataPipelineEnabled = true,
  platformAdmin = true,
): AppNavSearchResult<TItem>[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const terms = normalizedQuery.split(/\s+/);
  const items = getVisibleNavGroups(groups, dataPipelineEnabled, platformAdmin)
    .flatMap((group) =>
      group.items.map((item) => ({
        ...item,
        groupLabel: group.label,
      })),
    );
  const directMatches = items.filter((item) =>
    terms.every((term) =>
      normalizeSearchText(item.label, item.groupLabel, item.href).includes(term),
    ),
  );
  if (directMatches.length > 0) return directMatches;

  return items.filter((item) => {
    const searchable = normalizeSearchText(
      item.label,
      item.groupLabel,
      item.href,
      item.description,
      ...(item.keywords ?? []),
    );
    return terms.every((term) => searchable.includes(term));
  });
}

function normalizeSearchText(...parts: string[]) {
  return parts.join(" ").toLowerCase().replace(/[-/]/g, " ");
}
