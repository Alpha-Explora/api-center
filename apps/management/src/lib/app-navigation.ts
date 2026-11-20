export type EnvironmentKind = "test" | "live";

export type NavItem = {
  id: string;
  href: string;
  label: string;
  description: string;
  keywords?: string[];
  /** Only platform operators see it. */
  platformOnly?: boolean;
  /** Only organization owners and admins (and platform operators) see it. */
  organizationAdminOnly?: boolean;
};

/** Pages that act on the whole organization. */
export const organizationNav: NavItem[] = [
  {
    id: "projects",
    href: "/projects",
    label: "Projects",
    description: "Every project in the organization and its environments.",
    keywords: ["project", "environment", "create"],
  },
  {
    id: "people",
    href: "/people",
    label: "People",
    description: "Members, their organization roles, and teams.",
    keywords: ["members", "roles", "teams", "owner", "admin", "developer", "viewer", "invite"],
  },
  {
    id: "apis",
    href: "/apis",
    label: "API catalog",
    description: "Every active API that projects in the organization publish.",
    keywords: ["published", "operations", "actions", "access", "catalogue"],
  },
  {
    id: "quotas",
    href: "/quotas",
    label: "Quotas",
    description: "Shared request ceilings across several projects.",
    keywords: ["quota", "limit", "ceiling", "rate", "budget", "shared"],
    organizationAdminOnly: true,
  },
  {
    id: "approvals",
    href: "/approvals",
    label: "Approvals",
    description: "Live activations and API access requests waiting for a decision.",
    keywords: ["approve", "reject", "pending", "decide", "go live", "access requests", "queue"],
  },
  {
    id: "organizations",
    href: "/organizations",
    label: "Organizations",
    description: "Every organization: create, rename, suspend and reactivate.",
    keywords: ["organization", "tenant", "create", "rename", "suspend", "reactivate", "owner"],
    platformOnly: true,
  },
  {
    id: "requests",
    href: "/requests",
    label: "Requests",
    description: "Look up a gateway request by correlation ID.",
    keywords: ["diagnostics", "errors", "logs", "correlation", "status"],
    platformOnly: true,
  },
  {
    id: "settings",
    href: "/settings",
    label: "Settings",
    description: "The gateway this console uses and how it is configured.",
    keywords: ["configuration", "session", "gateway"],
    platformOnly: true,
  },
];

/** Sections of one project environment. `path` is relative to /projects/:projectId/:env. */
export const projectSections: { id: string; path: string; label: string; description: string; keywords?: string[] }[] = [
  { id: "overview", path: "", label: "Overview", description: "Status, plan, usage and going live.", keywords: ["plan", "usage", "go live", "readiness"] },
  {
    id: "applications",
    path: "/applications",
    label: "Applications",
    description: "Applications, their grants and API keys.",
    keywords: ["app", "keys", "credentials", "grants", "api key"],
  },
  {
    id: "capabilities",
    path: "/capabilities",
    label: "Capabilities",
    description: "Shared services enabled in this environment.",
    keywords: ["email", "sms", "otp", "payments", "geo", "google", "enable", "sender", "oauth", "redirect", "configure"],
  },
  {
    id: "apis",
    path: "/apis",
    label: "APIs",
    description: "Published APIs, their operations and incoming access requests.",
    keywords: ["publish", "operations", "upstream", "access requests", "approve"],
  },
  {
    id: "webhooks",
    path: "/webhooks",
    label: "Webhooks",
    description: "Payment event destinations and signing secrets.",
    keywords: ["events", "destinations", "signing secret", "rotate", "pubsub", "callback", "payment"],
  },
  {
    id: "quotas",
    path: "/quotas",
    label: "Quotas",
    description: "Request limits for this environment.",
    keywords: ["quota", "limit", "rate", "budget", "observe", "enforce"],
  },
];

/** Project pages that cover both environments, at /projects/:projectId/<path>. */
export const projectPages: { id: string; path: string; label: string; description: string; keywords?: string[] }[] = [
  {
    id: "settings",
    path: "/settings",
    label: "Settings",
    description: "Project roles and environment status.",
    keywords: ["roles", "members", "teams", "admin", "suspend", "resume", "status"],
  },
];

export function visibleOrganizationNav(platformAdmin: boolean, organizationAdmin = false) {
  return organizationNav.filter((item) => platformAdmin || (!item.platformOnly && (organizationAdmin || !item.organizationAdminOnly)));
}

export function projectHref(projectId: string, environment: EnvironmentKind, sectionPath = "") {
  return `/projects/${encodeURIComponent(projectId)}/${environment}${sectionPath}`;
}

export function projectPageHref(projectId: string, pagePath: string) {
  return `/projects/${encodeURIComponent(projectId)}${pagePath}`;
}

export type ConsoleLocation =
  | { kind: "organization"; sectionId: string | undefined }
  | { kind: "project"; projectId: string; environment: EnvironmentKind | undefined; sectionId: string | undefined; rest: string };

/**
 * Where a pathname sits in the console: an organization page, a project environment and its section, or a
 * project page that covers both environments (no environment).
 */
export function parseConsolePath(pathname: string): ConsoleLocation {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] === "projects" && segments[1]) {
    const page = projectPages.find((entry) => entry.path === `/${segments[2]}`);
    if (page) {
      const rest = `/${segments.slice(2).join("/")}`;
      return { kind: "project", projectId: decodeURIComponent(segments[1]), environment: undefined, sectionId: page.id, rest };
    }
    const environment = segments[2] === "test" || segments[2] === "live" ? segments[2] : undefined;
    const rest = environment ? `/${segments.slice(3).join("/")}`.replace(/\/$/, "") : "";
    const section = environment ? projectSections.find((entry) => entry.path && (rest === entry.path || rest.startsWith(`${entry.path}/`))) : undefined;
    return {
      kind: "project",
      projectId: decodeURIComponent(segments[1]),
      environment,
      sectionId: environment ? (section?.id ?? (rest === "" ? "overview" : undefined)) : undefined,
      rest,
    };
  }
  const item = organizationNav.find((entry) => pathname === entry.href || pathname.startsWith(`${entry.href}/`));
  return { kind: "organization", sectionId: item?.id };
}

/**
 * The same section in the other environment. Object pages (an application, an API) are environment-specific,
 * so switching lands on their section's list instead. Project pages cover both environments, so there is
 * nothing to switch to.
 */
export function switchEnvironmentPath(pathname: string, environment: EnvironmentKind): string | undefined {
  const location = parseConsolePath(pathname);
  if (location.kind !== "project" || !location.environment) return undefined;
  const section = projectSections.find((entry) => entry.id === location.sectionId);
  return projectHref(location.projectId, environment, section?.path ?? "");
}

/** Case-insensitive search over labels, descriptions and keywords; every word must match. */
export function matchesQuery(query: string, ...parts: (string | undefined)[]) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = parts.filter(Boolean).join(" ").toLowerCase().replace(/[-/]/g, " ");
  return terms.every((term) => haystack.includes(term));
}
