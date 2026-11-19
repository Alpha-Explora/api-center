"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon, MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { controlPlane } from "@/features/control-plane/data/control-plane-repository";
import { cpKeys } from "@/features/control-plane/view-models/query-keys";
import { useOrganization } from "@/features/control-plane/view-models/use-organization";
import { organizationNav, parseConsolePath, projectHref, projectPages, projectSections } from "@/lib/app-navigation";
import { cn } from "@/lib/utils";
import { CommandPalette } from "./command-palette";
import { Sidebar } from "./sidebar";

export function AppShell({
  children,
  authMode,
}: {
  children: ReactNode;
  authMode: "local-dev" | "google";
}) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = parseConsolePath(pathname);
  const live = location.kind === "project" && location.environment === "live";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:border focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
          <Sidebar authMode={authMode} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div aria-hidden className={cn("h-0.5 w-full", live ? "bg-live" : "bg-transparent")} />
          <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur sm:px-6">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Open navigation" className="-ml-1.5 lg:hidden" />}>
                <MenuIcon />
              </SheetTrigger>
              <SheetContent side="left" className="w-72 gap-0 bg-sidebar p-0" showCloseButton={false}>
                <SheetHeader className="sr-only">
                  <SheetTitle>Navigation</SheetTitle>
                </SheetHeader>
                <Sidebar authMode={authMode} onNavigate={() => setMobileNavOpen(false)} />
              </SheetContent>
            </Sheet>
            <Breadcrumbs />
            <div className="ml-auto flex items-center gap-2">
              {live ? (
                <span className="inline-flex h-6 items-center gap-1.5 rounded-sm bg-danger-soft px-2 text-xs font-medium text-live">
                  <span aria-hidden className="size-1.5 rounded-full bg-live" />
                  Live environment
                </span>
              ) : null}
              <ConsoleModeBadge authMode={authMode} />
            </div>
          </header>
          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-6xl min-w-0 flex-col gap-6">{children}</div>
          </main>
        </div>
      </div>
      <CommandPalette />
    </div>
  );
}

/**
 * Flags local-development sign-in. A deployed console manages both test and live environments, so it shows no
 * deployment badge (the live marker covers live pages); Settings names the deployment.
 */
function ConsoleModeBadge({ authMode }: { authMode: "local-dev" | "google" }) {
  if (authMode !== "local-dev") return null;
  return (
    <span title="Local development sign-in. Never deploy this mode." className="inline-flex h-6 items-center rounded-sm bg-warning-soft px-2 text-xs font-medium text-warning">
      Local dev
    </span>
  );
}

function Breadcrumbs() {
  const pathname = usePathname();
  const location = parseConsolePath(pathname);
  const { organizationId, organization } = useOrganization();
  const projectId = location.kind === "project" ? location.projectId : undefined;
  const project = useQuery({
    queryKey: cpKeys.project(organizationId ?? "none", projectId ?? "none"),
    queryFn: () => controlPlane.project(organizationId as string, projectId as string),
    enabled: Boolean(organizationId && projectId),
    retry: false,
  });

  const crumbs: { label: string; href?: string }[] = [];
  if (organization) crumbs.push({ label: organization.name, href: "/projects" });
  if (location.kind === "organization") {
    const item = organizationNav.find((entry) => entry.id === location.sectionId);
    if (item) crumbs.push({ label: item.label });
  } else {
    crumbs.push({ label: project.data?.name ?? "Project", href: projectHref(location.projectId, location.environment ?? "test") });
    const page = location.environment ? undefined : projectPages.find((entry) => entry.id === location.sectionId);
    if (page) crumbs.push({ label: page.label });
    const section = projectSections.find((entry) => entry.id === location.sectionId);
    if (section && section.id !== "overview" && location.environment) {
      const isList = location.rest === section.path;
      crumbs.push({ label: section.label, href: isList ? undefined : projectHref(location.projectId, location.environment, section.path) });
      if (!isList) crumbs.push({ label: "Details" });
    }
  }

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-[13px]">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={index} className={cn("flex min-w-0 items-center gap-1", !last && "hidden sm:flex")}>
              {index > 0 ? <ChevronRightIcon aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground/60", last && "max-sm:hidden")} /> : null}
              {crumb.href && !last ? (
                <Link href={crumb.href} className="truncate text-muted-foreground hover:text-foreground">
                  {crumb.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={cn("truncate", last ? "font-medium" : "text-muted-foreground")}>
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
