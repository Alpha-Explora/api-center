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
    label: "Workspace",
    items: [
      {
        href: "/control-plane/projects",
        label: "Projects",
        description: "Projects, environments, capabilities, applications, grants and keys.",
        keywords: ["project", "application", "api key", "credential", "grant", "capability", "live", "webhook"],
      },
      {
        href: "/control-plane/people",
        label: "People",
        description: "Organization members, roles and teams.",
        keywords: ["members", "roles", "teams", "owner", "admin", "developer", "viewer"],
      },
    ],
  },
  {
    label: "Operations",
    items: [
      {
        href: "/requests",
        label: "Requests",
        description: "Recent gateway requests, their status and where they failed.",
        keywords: ["diagnostics", "errors", "logs", "status", "audit"],
      },
      {
        href: "/settings",
        label: "Settings",
        description: "The gateway this console uses and how it is configured.",
        keywords: ["configuration", "environment", "session"],
      },
    ],
  },
];

/** Hides the platform-operator pages from organization members. */
export function getVisibleNavGroups<TItem extends AppNavItem>(
  groups: AppNavGroup<TItem>[],
  platformAdmin = true,
) {
  const platformOnlyHrefs = new Set(["/settings"]);
  return groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => platformAdmin || !platformOnlyHrefs.has(item.href)),
  }));
}

export function getNavSearchResults<TItem extends AppNavItem>(
  groups: AppNavGroup<TItem>[],
  query: string,
  platformAdmin = true,
): AppNavSearchResult<TItem>[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const terms = normalizedQuery.split(/\s+/);
  const items = getVisibleNavGroups(groups, platformAdmin)
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
