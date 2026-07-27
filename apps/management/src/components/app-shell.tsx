"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ActivityIcon,
  BellIcon,
  BarChart3Icon,
  BookOpenIcon,
  CheckCircleIcon,
  CircleIcon,
  ClipboardCheckIcon,
  DatabaseZapIcon,
  FileJsonIcon,
  FlaskConicalIcon,
  GaugeIcon,
  ListChecksIcon,
  HomeIcon,
  MenuIcon,
  NetworkIcon,
  RocketIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  StoreIcon,
} from "lucide-react";
import { EnvironmentBanner } from "@/components/environment-banner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { getManagementSession } from "@/lib/api-center-client";
import {
  commandCenterNavGroups,
  getNavSearchResults,
  getVisibleNavGroups,
} from "@/lib/app-navigation";
import { isDataPipelineEnabled } from "@/lib/feature-flags";
import { queryKeys } from "@/lib/query-keys";
import type { ManagementEnvironment } from "@/lib/management-environment";
import { MANAGEMENT_SIGN_OUT_EVENT } from "@/components/management-auth-gate";

type NavIcon = React.ComponentType<{
  "data-icon"?: string;
  className?: string;
}>;

const navIconByHref: Record<string, NavIcon> = {
  "/dashboard": HomeIcon,
  "/lifecycle": ListChecksIcon,
  "/alerts": BellIcon,
  "/readiness": CheckCircleIcon,
  "/tribes": NetworkIcon,
  "/api-catalog": FileJsonIcon,
  "/registration-requests": ClipboardCheckIcon,
  "/dependencies": NetworkIcon,
  "/marketplace": StoreIcon,
  "/developer-portal": BookOpenIcon,
  "/shared-services": NetworkIcon,
  "/quotas": GaugeIcon,
  "/reliability": ActivityIcon,
  "/data-pipeline": DatabaseZapIcon,
  "/cost": BarChart3Icon,
  "/plans": ListChecksIcon,
  "/compliance": ClipboardCheckIcon,
  "/audit": ListChecksIcon,
  "/operational-trust": ShieldCheckIcon,
  "/promotions": RocketIcon,
  "/docs/consumer-runbook": BookOpenIcon,
  "/manifest-tools": FileJsonIcon,
  "/smoke-tests": FlaskConicalIcon,
  "/settings": SettingsIcon,
};

const navGroups = commandCenterNavGroups.map((group) => ({
  ...group,
  items: group.items.map((item) => ({
    ...item,
    icon: navIconByHref[item.href] ?? CircleIcon,
  })),
}));

export function AppShell({
  children,
  environment,
  authMode,
}: {
  children: React.ReactNode;
  environment: ManagementEnvironment;
  authMode: "local-dev" | "google";
}) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const sessionQuery = useQuery({
    queryKey: queryKeys.managementSession,
    queryFn: getManagementSession,
    staleTime: 60_000,
  });
  const session = sessionQuery.data;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Link
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-sm"
      >
        Skip to main content
      </Link>
      <div className="flex min-h-screen w-full">
        <aside className="sidebar-scroll sticky top-0 hidden h-screen w-64 shrink-0 overflow-y-auto border-r border-sidebar-border bg-sidebar px-4 py-5 lg:block">
          <SidebarContent pathname={pathname} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <EnvironmentBanner
            environment={environment.isLive ? "live" : "test"}
            authMode={authMode}
          />
          <div className="min-w-0 overflow-hidden border-b border-border bg-card px-4 py-2 text-xs text-muted-foreground sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-[1480px] flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
              <WorkflowSearch />
              <span className="flex min-w-0 items-center gap-2 text-balance">
                <CircleIcon
                  data-icon="inline-start"
                  className="shrink-0 fill-[var(--brand-green)] text-[var(--brand-green)]"
                />
                <Badge
                  variant={environment.isLive ? "destructive" : "secondary"}
                  className="shrink-0"
                >
                  {environment.label}
                </Badge>
                <span className="min-w-0">{environment.description}</span>
              </span>
              <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
                <span className="flex min-w-0 items-center gap-2">
                  <Badge variant="outline" className="shrink-0">
                    {session
                      ? formatSessionAccess(session.role)
                      : sessionQuery.isLoading
                        ? "loading access"
                        : "access unavailable"}
                  </Badge>
                  {session?.email ? (
                    <span className="hidden min-w-0 truncate md:inline">
                      {session.email}
                    </span>
                  ) : null}
                  {authMode === "google" ? <GoogleSignOutButton /> : null}
                </span>
                <Link
                  href="/readiness"
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Check readiness
                </Link>
              </div>
            </div>
          </div>
          <header className="sticky top-0 z-10 min-w-0 overflow-hidden border-b bg-card/95 px-4 py-3 backdrop-blur lg:hidden">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                  <SheetTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Open navigation"
                        className="border-transparent bg-transparent"
                      />
                    }
                  >
                    <MenuIcon />
                  </SheetTrigger>
                  <SheetContent
                    side="left"
                    className="w-72 p-0"
                    showCloseButton={false}
                  >
                    <SheetHeader className="sr-only">
                      <SheetTitle>Navigation</SheetTitle>
                    </SheetHeader>
                    <div className="sidebar-scroll h-full overflow-y-auto bg-sidebar px-4 py-5">
                      <SidebarContent
                        pathname={pathname}
                        onNavigate={() => setMobileNavOpen(false)}
                      />
                    </div>
                  </SheetContent>
                </Sheet>
                <Link
                  href="/dashboard"
                  className="flex min-w-0 items-center gap-2 truncate font-semibold"
                >
                  <Image
                    src="/brand/apicenter-logo-icon-v2.png"
                    alt=""
                    aria-hidden="true"
                    width={28}
                    height={28}
                    className="size-7 shrink-0 object-contain"
                  />
                  APICenter
                </Link>
              </div>
              <nav className="flex min-w-0 max-w-[44vw] gap-2 overflow-hidden text-xs text-muted-foreground min-[420px]:max-w-[60vw]">
                <Link href="/readiness">Readiness</Link>
                <Link className="hidden sm:inline" href="/tribes">
                  Registry
                </Link>
                <Link className="hidden sm:inline" href="/settings">
                  Settings
                </Link>
              </nav>
            </div>
          </header>
          <main
            id="main-content"
            tabIndex={-1}
            className="min-w-0 flex-1 overflow-hidden px-4 py-6 sm:px-6 lg:px-8"
          >
            <div className="mx-auto min-w-0 max-w-[1480px]">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

function WorkflowSearch() {
  const [query, setQuery] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const dataPipelineEnabled = isDataPipelineEnabled();
  const results = React.useMemo(
    () => getNavSearchResults(navGroups, query, dataPipelineEnabled).slice(0, 6),
    [dataPipelineEnabled, query],
  );
  const showResults = focused && query.trim().length > 0;

  return (
    <div className="relative min-w-0 xl:w-[28rem]">
      <label className="sr-only" htmlFor="workflow-search">
        Find command or workflow
      </label>
      <div className="flex h-9 min-w-0 items-center gap-2 rounded-lg border bg-background px-2.5 text-sm text-muted-foreground">
        <SearchIcon data-icon="inline-start" className="size-4 shrink-0" />
        <input
          id="workflow-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          placeholder="Find command or workflow"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
      {showResults ? (
        <div className="absolute left-0 right-0 top-10 z-30 overflow-hidden rounded-lg border bg-popover text-sm text-popover-foreground shadow-sm">
          {results.length > 0 ? (
            results.map((item) => {
              const Icon = item.icon ?? CircleIcon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-start gap-2 border-b px-3 py-2 last:border-b-0 hover:bg-muted"
                  onClick={() => {
                    setQuery("");
                    setFocused(false);
                  }}
                >
                  <Icon data-icon="inline-start" className="mt-0.5 size-4" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {item.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.groupLabel} - {item.description}
                    </span>
                  </span>
                </Link>
              );
            })
          ) : (
            <div className="px-3 py-2 text-muted-foreground">
              No matching workflow.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function GoogleSignOutButton() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => window.dispatchEvent(new Event(MANAGEMENT_SIGN_OUT_EVENT))}
    >
      Sign out
    </Button>
  );
}

function formatSessionAccess(role: string) {
  if (role === "admin") return "full access";
  if (role === "operator") return "change access";
  if (role === "observer") return "read access";
  return role;
}

function SidebarContent({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const visibleNavGroups = getVisibleNavGroups(
    navGroups,
    isDataPipelineEnabled(),
  );

  return (
    <>
      <Link
        href="/dashboard"
        className="flex items-center gap-3 px-1"
        onClick={onNavigate}
      >
        <Image
          src="/brand/apicenter-logo-icon-v2.png"
          alt=""
          aria-hidden="true"
          width={36}
          height={36}
          className="size-9 shrink-0 object-contain"
        />
        <span className="flex flex-col">
          <span className="text-sm font-semibold leading-5">APICenter</span>
          <span className="text-xs text-muted-foreground">Console</span>
        </span>
      </Link>
      <Separator className="my-5" />
      <nav className="flex flex-col gap-4">
        {visibleNavGroups.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <div className="px-2.5 text-xs font-medium text-muted-foreground">
              {group.label}
            </div>
            {group.items.map((item) => (
              <NavLink
                key={item.href}
                href={item.href}
                label={item.label}
                icon={item.icon}
                active={isNavActive(pathname, item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}

function isNavActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === "/dashboard";
  if (href === "/tribes") {
    return pathname === "/tribes" || pathname.startsWith("/tribes/");
  }
  if (href === "/shared-services") {
    return (
      pathname === "/shared-services" || pathname === "/shared-services/setup"
    );
  }
  return pathname === href || pathname.startsWith(`${href}/`);
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
  icon: React.ComponentType<{ "data-icon"?: string; className?: string }>;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={navLinkClassName(active)}
      onClick={onNavigate}
    >
      <Icon data-icon="inline-start" />
      {label}
    </Link>
  );
}

function navLinkClassName(active: boolean) {
  return cn(
    "relative flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
    active &&
      "bg-[var(--brand-green-soft)] font-medium text-[var(--brand-green-deep)]",
  );
}
