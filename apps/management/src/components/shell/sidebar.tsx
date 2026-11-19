"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIcon,
  AppWindowIcon,
  BlocksIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  FolderIcon,
  LayoutDashboardIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon,
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
import { cpKeys } from "@/features/control-plane/view-models/query-keys";
import { useOrganization } from "@/features/control-plane/view-models/use-organization";
import {
  parseConsolePath,
  projectHref,
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
  requests: ActivityIcon,
  settings: SettingsIcon,
};

const SECTION_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboardIcon,
  applications: AppWindowIcon,
  capabilities: BlocksIcon,
  webhooks: WebhookIcon,
};

export function Sidebar({ authMode, onNavigate }: { authMode: "local-dev" | "google"; onNavigate?: () => void }) {
  const pathname = usePathname();
  const location = parseConsolePath(pathname);
  const { platformAdmin } = useOrganization();

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
          {visibleOrganizationNav(platformAdmin).map((item) => (
            <li key={item.id}>
              <NavLink
                href={item.href}
                label={item.label}
                icon={ORGANIZATION_ICONS[item.id] ?? FolderIcon}
                active={location.kind === "organization" && location.sectionId === item.id}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>

        {location.kind === "project" && location.environment ? (
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
        <Image src="/brand/apicenter-logo-icon-v2.png" alt="" aria-hidden width={24} height={24} className="size-6 shrink-0 object-contain" />
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

function ProjectNav({
  projectId,
  environment,
  sectionId,
  onNavigate,
}: {
  projectId: string;
  environment: EnvironmentKind;
  sectionId: string | undefined;
  onNavigate?: () => void;
}) {
  const { organizationId } = useOrganization();
  const pathname = usePathname();
  const router = useRouter();
  const project = useQuery({
    queryKey: cpKeys.project(organizationId ?? "none", projectId),
    queryFn: () => controlPlane.project(organizationId as string, projectId),
    enabled: Boolean(organizationId),
    retry: false,
  });
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
          if (href) router.push(href);
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
              active={sectionId === section.id}
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
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
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
    </Link>
  );
}
