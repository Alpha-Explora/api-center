"use client";
import { BrandMark } from "@/components/brand-mark";
import Link from "next/link";
import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIcon,
  AppWindowIcon,
  BlocksIcon,
  Building2Icon,
  CheckIcon,
  ChevronsUpDownIcon,
  FolderIcon,
  GaugeIcon,
  InboxIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  SearchIcon,
  Settings2Icon,
  SettingsIcon,
  UsersIcon,
  WaypointsIcon,
  WebhookIcon,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/patterns/form";
import { controlPlane } from "@/features/control-plane/data/control-plane-repository";
import { EXPIRY_WARNING_DAYS, keysNeedingReplacement } from "@/features/control-plane/model/environment-inventory";
import { useEnvironmentCredentials } from "@/features/control-plane/view-models/environment-inventory";
import { cpKeys } from "@/features/control-plane/view-models/query-keys";
import { awaitingYou } from "@/features/control-plane/model/approvals";
import { useApprovals } from "@/features/control-plane/view-models/approvals";
import { useAccess, useOrganization } from "@/features/control-plane/view-models/use-organization";
import {
  parseConsolePath,
  projectHref,
  projectPageHref,
  projectPages,
  projectSections,
  switchEnvironmentPath,
  visibleOrganizationNav,
  type EnvironmentKind,
} from "@/lib/app-navigation";
import { cn } from "@/lib/utils";
import { OPEN_COMMAND_PALETTE_EVENT } from "./command-palette";
import { UserMenu } from "./user-menu";

const ORGANIZATION_ICONS: Record<string, LucideIcon> = {
  projects: FolderIcon,
  people: UsersIcon,
  apis: WaypointsIcon,
  quotas: GaugeIcon,
  approvals: InboxIcon,
  organizations: Building2Icon,
  audit: HistoryIcon,
  requests: ActivityIcon,
  settings: SettingsIcon,
};

const SECTION_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboardIcon,
  applications: AppWindowIcon,
  capabilities: BlocksIcon,
  apis: WaypointsIcon,
  webhooks: WebhookIcon,
  requests: ActivityIcon,
  quotas: GaugeIcon,
  settings: Settings2Icon,
};

export function Sidebar({ authMode, onNavigate }: { authMode: "local-dev" | "google"; onNavigate?: () => void }) {
  const pathname = usePathname();
  const location = parseConsolePath(pathname);
  const { organizationId, platformAdmin } = useOrganization();
  const { access } = useAccess(organizationId);
  const pending = awaitingYou(useApprovals().data);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 p-3">
        <OrganizationSwitcher />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}
          className="flex h-8 items-center gap-2 rounded-md border bg-card px-2.5 text-[13px] text-muted-foreground shadow-xs transition-colors hover:text-foreground dark:bg-input/20"
        >
          <SearchIcon className="size-3.5" />
          <span className="flex-1 text-left">Search…</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      <nav aria-label="Console" className="sidebar-scroll flex flex-1 flex-col gap-5 overflow-y-auto px-3 pb-3">
        <ul className="flex flex-col gap-px">
          {visibleOrganizationNav(platformAdmin, access.canManageQuotas).map((item) => (
            <li key={item.id}>
              <NavLink
                href={item.href}
                label={item.label}
                icon={ORGANIZATION_ICONS[item.id] ?? FolderIcon}
                badge={item.id === "approvals" && pending > 0 ? pending : undefined}
                active={location.kind === "organization" && location.sectionId === item.id}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>

        {location.kind === "project" ? (
          <ProjectNav projectId={location.projectId} environment={location.environment} sectionId={location.sectionId} onNavigate={onNavigate} />
        ) : null}
      </nav>

      <div className="border-t p-3">
        <UserMenu authMode={authMode} />
      </div>
    </div>
  );
}

function OrganizationSwitcher() {
  const { organization, organizations, setOrganizationId, platformAdmin } = useOrganization();
  const router = useRouter();
  const label = organization?.name ?? (platformAdmin ? "Choose organization" : "No organization");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="flex h-10 w-full items-center gap-2.5 rounded-md px-1.5 text-left transition-colors hover:bg-sidebar-accent aria-expanded:bg-sidebar-accent"
          />
        }
      >
        <BrandMark />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13px] leading-4 font-semibold">{label}</span>
          <span className="truncate text-[11px] leading-4 text-muted-foreground">APICenter</span>
        </span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Organizations</DropdownMenuLabel>
          {organizations.map((entry) => (
            <DropdownMenuItem
              key={entry.id}
              onClick={() => {
                setOrganizationId(entry.id);
                router.push("/projects");
              }}
            >
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.id === organization?.id ? <CheckIcon className="size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
          {organizations.length === 0 ? <DropdownMenuItem disabled>No memberships</DropdownMenuItem> : null}
        </DropdownMenuGroup>
        {platformAdmin ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/projects?organization=choose")}>Open by organization ID…</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const LAST_ENVIRONMENT_KEY = "apicenter.console.lastEnvironment";
const LAST_ENVIRONMENT_EVENT = "apicenter:last-environment-change";

function readLastEnvironment(projectId: string): EnvironmentKind | undefined {
  try {
    const value = window.sessionStorage.getItem(`${LAST_ENVIRONMENT_KEY}:${projectId}`);
    return value === "test" || value === "live" ? value : undefined;
  } catch {
    return undefined;
  }
}

function subscribeLastEnvironment(onChange: () => void) {
  window.addEventListener(LAST_ENVIRONMENT_EVENT, onChange);
  return () => window.removeEventListener(LAST_ENVIRONMENT_EVENT, onChange);
}

/**
 * The environment the project nav links to. On an environment page it is that page's; on a project page that
 * covers both (Settings) it is the one last visited, so leaving Settings returns to where the person was.
 */
function useNavEnvironment(projectId: string, current: EnvironmentKind | undefined) {
  const remembered = useSyncExternalStore(subscribeLastEnvironment, () => readLastEnvironment(projectId), () => undefined);
  const remember = useCallback(
    (value: EnvironmentKind) => {
      try {
        window.sessionStorage.setItem(`${LAST_ENVIRONMENT_KEY}:${projectId}`, value);
      } catch {
        // Remembering is a convenience only.
      }
      window.dispatchEvent(new Event(LAST_ENVIRONMENT_EVENT));
    },
    [projectId],
  );
  useEffect(() => {
    if (current) remember(current);
  }, [current, remember]);
  return { environment: current ?? remembered ?? "test", remember };
}

function ProjectNav({
  projectId,
  environment: current,
  sectionId,
  onNavigate,
}: {
  projectId: string;
  /** Undefined on project pages that cover both environments. */
  environment: EnvironmentKind | undefined;
  sectionId: string | undefined;
  onNavigate?: () => void;
}) {
  const { environment, remember } = useNavEnvironment(projectId, current);
  const { organizationId } = useOrganization();
  const pathname = usePathname();
  const router = useRouter();
  const project = useQuery({
    queryKey: cpKeys.project(organizationId ?? "none", projectId),
    queryFn: () => controlPlane.project(organizationId as string, projectId),
    enabled: Boolean(organizationId),
    retry: false,
  });
  const credentials = useEnvironmentCredentials({
    organizationId,
    projectId,
    kind: environment,
    enabled: Boolean(project.data?.environments.some((entry) => entry.kind === environment)),
  });
  const expiringKeys = keysNeedingReplacement(credentials.data ?? []).length;
  const projects = useQuery({
    queryKey: cpKeys.projects(organizationId ?? "none"),
    queryFn: () => controlPlane.listProjects(organizationId as string),
    enabled: Boolean(organizationId),
    retry: false,
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Project</div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md border bg-card px-2.5 text-left text-[13px] font-medium shadow-xs hover:bg-muted aria-expanded:bg-muted dark:bg-input/20"
            />
          }
        >
          <span className="min-w-0 flex-1 truncate">{project.data?.name ?? "Loading…"}</span>
          <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-60" align="start">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Projects</DropdownMenuLabel>
            {(projects.data ?? []).map((entry) => (
              <DropdownMenuItem key={entry.id} onClick={() => router.push(projectHref(entry.id, environment))}>
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                {entry.id === projectId ? <CheckIcon className="size-3.5" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => router.push("/projects")}>All projects</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <EnvironmentSwitch
        value={environment}
        onChange={(next) => {
          const href = switchEnvironmentPath(pathname, next);
          if (!href) {
            // A page covering both environments stays put; the section links follow the switch.
            remember(next);
            return;
          }
          router.push(href);
          onNavigate?.();
        }}
      />

      <ul className="flex flex-col gap-px">
        {projectSections.map((section) => (
          <li key={section.id}>
            <NavLink
              href={projectHref(projectId, environment, section.path)}
              label={section.label}
              icon={SECTION_ICONS[section.id] ?? FolderIcon}
              active={current !== undefined && sectionId === section.id}
              onNavigate={onNavigate}
              badge={
                section.id === "applications" && expiringKeys > 0 ? (
                  <span
                    className="ml-auto rounded-sm bg-warning-soft px-1.5 text-[11px] leading-4 font-medium text-warning tabular-nums"
                    title={`${expiringKeys} key${expiringKeys === 1 ? "" : "s"} expired or expiring within ${EXPIRY_WARNING_DAYS} days`}
                    aria-label={`${expiringKeys} expiring key${expiringKeys === 1 ? "" : "s"}`}
                  >
                    {expiringKeys}
                  </span>
                ) : undefined
              }
            />
          </li>
        ))}
        {projectPages.map((page) => (
          <li key={page.id}>
            <NavLink
              href={projectPageHref(projectId, page.path)}
              label={page.label}
              icon={SECTION_ICONS[page.id] ?? FolderIcon}
              active={current === undefined && sectionId === page.id}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Test and live are separate; live is marked red wherever it is selected. */
export function EnvironmentSwitch({ value, onChange }: { value: EnvironmentKind; onChange: (value: EnvironmentKind) => void }) {
  return (
    <div role="radiogroup" aria-label="Environment" className="grid grid-cols-2 gap-0.5 rounded-md bg-sidebar-accent p-0.5">
      {(["test", "live"] as const).map((kind) => {
        const selected = value === kind;
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => !selected && onChange(kind)}
            className={cn(
              "flex h-7 items-center justify-center gap-1.5 rounded-[5px] text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
              selected && "bg-card text-foreground shadow-xs dark:bg-input/40",
              selected && kind === "live" && "text-live",
            )}
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", kind === "live" ? "bg-live" : "bg-muted-foreground/60")} />
            {kind === "test" ? "Test" : "Live"}
          </button>
        );
      })}
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  badge,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown at the end of the row: a number becomes a count pill (pending approvals); anything else renders as given. */
  badge?: ReactNode;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
      {label}
      {typeof badge === "number" ? (
        <span className="ml-auto inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-medium text-primary-foreground tabular-nums">
          <span className="sr-only">, </span>
          {badge > 99 ? "99+" : badge}
          <span className="sr-only"> pending</span>
        </span>
      ) : (
        badge
      )}
    </Link>
  );
}
