"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CornerDownLeftIcon, FolderIcon, MoonIcon, SearchIcon, SunIcon, type LucideIcon, ArrowRightIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { controlPlane } from "@/features/control-plane/data/control-plane-repository";
import { cpKeys } from "@/features/control-plane/view-models/query-keys";
import { useOrganization } from "@/features/control-plane/view-models/use-organization";
import { matchesQuery, parseConsolePath, projectHref, projectSections, visibleOrganizationNav } from "@/lib/app-navigation";
import { cn } from "@/lib/utils";

export const OPEN_COMMAND_PALETTE_EVENT = "apicenter:open-command-palette";

type Command = { id: string; group: string; label: string; hint?: string; keywords?: string; icon: LucideIcon; run: () => void };

/** ⌘K / Ctrl+K: jump to any page, project or section, or switch theme. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const { setTheme, resolvedTheme } = useTheme();
  const { organizationId, platformAdmin } = useOrganization();
  const projects = useQuery({
    queryKey: cpKeys.projects(organizationId ?? "none"),
    queryFn: () => controlPlane.listProjects(organizationId as string),
    enabled: Boolean(organizationId) && open,
    retry: false,
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpen);
    };
  }, []);

  const commands = useMemo<Command[]>(() => {
    const go = (href: string) => () => router.push(href);
    const location = parseConsolePath(pathname);
    const list: Command[] = [];
    if (location.kind === "project") {
      for (const environment of ["test", "live"] as const) {
        for (const section of projectSections) {
          list.push({
            id: `section-${environment}-${section.id}`,
            group: "This project",
            label: `${section.label}`,
            hint: environment === "live" ? "Live" : "Test",
            keywords: `${section.description} ${section.keywords?.join(" ") ?? ""} ${environment}`,
            icon: ArrowRightIcon,
            run: go(projectHref(location.projectId, environment, section.path)),
          });
        }
      }
    }
    for (const item of visibleOrganizationNav(platformAdmin)) {
      list.push({ id: `nav-${item.id}`, group: "Pages", label: item.label, keywords: `${item.description} ${item.keywords?.join(" ") ?? ""}`, icon: ArrowRightIcon, run: go(item.href) });
    }
    for (const project of projects.data ?? []) {
      list.push({ id: `project-${project.id}`, group: "Projects", label: project.name, hint: project.slug, keywords: project.slug, icon: FolderIcon, run: go(projectHref(project.id, "test")) });
    }
    list.push({
      id: "theme",
      group: "Preferences",
      label: resolvedTheme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      keywords: "theme dark light appearance",
      icon: resolvedTheme === "dark" ? SunIcon : MoonIcon,
      run: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
    });
    return list;
  }, [pathname, platformAdmin, projects.data, resolvedTheme, router, setTheme]);

  const results = commands.filter((command) => matchesQuery(query, command.label, command.group, command.hint, command.keywords));
  const groups = [...new Set(results.map((command) => command.group))];
  const ordered = groups.flatMap((group) => results.filter((command) => command.group === group));
  const selected = Math.min(active, Math.max(ordered.length - 1, 0));

  function close() {
    setOpen(false);
    setQuery("");
    setActive(0);
  }

  function run(command: Command | undefined) {
    if (!command) return;
    close();
    command.run();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <DialogContent showCloseButton={false} className="top-[18%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Search the console</DialogTitle>
        <div className="flex items-center gap-2 border-b px-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            aria-label="Search pages, projects and actions"
            role="combobox"
            aria-expanded
            aria-controls="command-results"
            aria-activedescendant={ordered[selected] ? `command-${ordered[selected].id}` : undefined}
            placeholder="Search pages, projects and actions…"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((value) => Math.min(value + 1, ordered.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((value) => Math.max(value - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                run(ordered[selected]);
              }
            }}
          />
        </div>
        <div ref={listRef} id="command-results" role="listbox" className="max-h-80 overflow-y-auto p-1.5">
          {ordered.length === 0 ? <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Nothing matches “{query}”.</p> : null}
          {groups.map((group) => (
            <div key={group} role="group" aria-label={group} className="pb-1">
              <div className="px-2 pt-2 pb-1 text-[11px] font-medium text-muted-foreground">{group}</div>
              {ordered
                .filter((command) => command.group === group)
                .map((command) => {
                  const index = ordered.indexOf(command);
                  const Icon = command.icon;
                  return (
                    <div
                      key={command.id}
                      id={`command-${command.id}`}
                      role="option"
                      aria-selected={index === selected}
                      onMouseMove={() => setActive(index)}
                      onClick={() => run(command)}
                      className={cn("flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2 text-[13px]", index === selected && "bg-accent")}
                    >
                      <Icon className="size-4 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{command.label}</span>
                      {command.hint ? <span className="truncate font-mono text-xs text-muted-foreground">{command.hint}</span> : null}
                      {index === selected ? <CornerDownLeftIcon className="size-3.5 text-muted-foreground" /> : null}
                    </div>
                  );
                })}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
