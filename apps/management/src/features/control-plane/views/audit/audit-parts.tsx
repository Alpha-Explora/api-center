"use client";
import { Fragment, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IdText } from "@/components/patterns/copy-button";
import { DescriptionList } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDateTime, formatActor } from "@/lib/format";
import { auditActionLabel, type AuditEntry } from "../../model/observability";
import { auditChanges, groupAuditEntries } from "../../model/audit-view";
import { RelativeTime } from "@/components/patterns/relative-time";
import { ActorLabel } from "@/components/patterns/actor-label";

/**
 * Audit events as a table. `projectName` resolves project IDs; `showProject` adds the project column;
 * `organizationName` adds each event's organization under it, for the platform-wide log.
 */
export function AuditTable({
  entries,
  onSelect,
  projectName,
  showProject = true,
  organizationName,
}: {
  entries: AuditEntry[];
  onSelect: (entry: AuditEntry) => void;
  projectName?: (projectId: string) => string | undefined;
  showProject?: boolean;
  organizationName?: (organizationId: string) => string;
}) {
  // Runs of the same change whose repeats are shown.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const columns = 3 + (showProject ? 1 : 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Action</TableHead>
          <TableHead className="hidden sm:table-cell">Actor</TableHead>
          {showProject ? <TableHead className="hidden md:table-cell">Project</TableHead> : null}
          <TableHead className="text-right">When</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groupAuditEntries(entries).map((day) => (
          <Fragment key={day.key}>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns} className="bg-muted/30 py-1.5 text-xs font-medium text-muted-foreground">
                {day.label}
              </TableCell>
            </TableRow>
            {day.rows.map((row) => {
              const open = expanded.has(row.entry.id);
              return (
                <Fragment key={row.entry.id}>
                  <AuditRow
                    entry={row.entry}
                    repeats={row.repeats.length}
                    open={open}
                    onToggle={() =>
                      setExpanded((current) => {
                        const next = new Set(current);
                        if (next.has(row.entry.id)) next.delete(row.entry.id);
                        else next.add(row.entry.id);
                        return next;
                      })
                    }
                    onSelect={onSelect}
                    projectName={projectName}
                    showProject={showProject}
                    organizationName={organizationName}
                  />
                  {open
                    ? row.repeats.map((repeat) => (
                        <AuditRow
                          key={repeat.id}
                          entry={repeat}
                          repeat
                          onSelect={onSelect}
                          projectName={projectName}
                          showProject={showProject}
                          organizationName={organizationName}
                        />
                      ))
                    : null}
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </TableBody>
    </Table>
  );
}

/** One audit event; `repeats` shows a ×N toggle for later events of the same change, `repeat` marks one of them. */
function AuditRow({
  entry,
  repeats = 0,
  repeat = false,
  open = false,
  onToggle,
  onSelect,
  projectName,
  showProject,
  organizationName,
}: {
  entry: AuditEntry;
  repeats?: number;
  repeat?: boolean;
  open?: boolean;
  onToggle?: () => void;
  onSelect: (entry: AuditEntry) => void;
  projectName?: (projectId: string) => string | undefined;
  showProject: boolean;
  organizationName?: (organizationId: string) => string;
}) {
  return (
    <TableRow className={repeat ? "cursor-pointer bg-muted/20 text-muted-foreground" : "cursor-pointer"} onClick={() => onSelect(entry)}>
      <TableCell className={repeat ? "max-w-64 pl-8 whitespace-normal" : "max-w-64 whitespace-normal"}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <button
            type="button"
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-left hover:underline focus-visible:underline focus-visible:outline-none"
            onClick={(event) => {
              event.stopPropagation();
              onSelect(entry);
            }}
          >
            <span className={repeat ? undefined : "font-medium"}>{auditActionLabel(entry.action)}</span>
            {entry.environment ? <EnvironmentTag kind={entry.environment} /> : null}
            {entry.outcome !== "succeeded" ? <StatusBadge status={entry.outcome} /> : null}
          </button>
          {repeats > 0 ? (
            <button
              type="button"
              aria-expanded={open}
              aria-label={`${open ? "Hide" : "Show"} ${repeats} more of the same change`}
              onClick={(event) => {
                event.stopPropagation();
                onToggle?.();
              }}
              className="inline-flex h-5 items-center rounded-sm bg-muted px-1.5 text-xs text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            >
              ×{repeats + 1}
            </button>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground sm:hidden">
          <ActorLabel actor={entry.actor} />
        </div>
      </TableCell>
      <TableCell className="hidden max-w-64 sm:table-cell">
        <ActorLabel actor={entry.actor} className="max-w-full" />
      </TableCell>
      {showProject ? (
        <TableCell className="hidden max-w-48 truncate md:table-cell">
          {entry.projectId ? (
            (projectName?.(entry.projectId) ?? <span className="font-mono text-xs">{entry.projectId}</span>)
          ) : (
            <span className="text-muted-foreground">{organizationName ? (entry.organizationId ? "Organization" : "Platform") : "Organization"}</span>
          )}
          {organizationName && entry.organizationId ? <span className="block truncate text-xs text-muted-foreground">{organizationName(entry.organizationId)}</span> : null}
        </TableCell>
      ) : null}
      <TableCell className="text-right whitespace-nowrap text-muted-foreground">
        <RelativeTime value={entry.occurredAt} />
      </TableCell>
    </TableRow>
  );
}

function EnvironmentTag({ kind }: { kind: "test" | "live" }) {
  return kind === "live" ? (
    <span className="rounded-sm bg-live/10 px-1.5 text-xs font-medium text-live">Live</span>
  ) : (
    <span className="rounded-sm bg-muted px-1.5 text-xs text-muted-foreground">Test</span>
  );
}

export function AuditSheet({
  entry,
  projectName,
  organizationName,
  onOpenChange,
}: {
  entry: AuditEntry | null;
  projectName?: (projectId: string) => string | undefined;
  organizationName?: (organizationId: string) => string;
  onOpenChange: (open: boolean) => void;
}) {
  const details = entry ? Object.entries(entry.details) : [];
  const changes = entry ? auditChanges(entry.details) : [];
  return (
    <Sheet open={entry !== null} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        {entry ? (
          <>
            <SheetHeader>
              <SheetTitle>{auditActionLabel(entry.action)}</SheetTitle>
              <SheetDescription>
                {formatDateTime(entry.occurredAt)} by {formatActor(entry.actor).name}{formatActor(entry.actor).via ? " via the platform" : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
              <DescriptionList
                items={[
                  {
                    label: "Action",
                    value: <span className="font-mono text-xs break-all">{entry.action}</span>,
                  },
                  {
                    label: "Outcome",
                    value: <StatusBadge tone={entry.outcome === "succeeded" ? "success" : "danger"}>{entry.outcome}</StatusBadge>,
                  },
                  { label: "Actor", value: <span className="break-all">{entry.actor ?? "System"}</span> },
                  ...(organizationName
                    ? [{ label: "Organization", value: entry.organizationId ? organizationName(entry.organizationId) : "None (platform event)" }]
                    : []),
                  {
                    label: "Project",
                    value: entry.projectId ? (projectName?.(entry.projectId) ?? <IdText value={entry.projectId} />) : "Organization-wide",
                  },
                  { label: "Environment", value: entry.environment ?? "—" },
                  {
                    label: "Resource",
                    value: <span className="font-mono text-xs break-all">{entry.resourceType}</span>,
                  },
                  {
                    label: "Resource ID",
                    value: entry.resourceId ? <IdText value={entry.resourceId} /> : "—",
                  },
                  ...(entry.correlationId
                    ? [
                        {
                          label: "Correlation ID",
                          value: <IdText value={entry.correlationId} />,
                        },
                      ]
                    : []),
                  { label: "Event ID", value: <IdText value={entry.id} /> },
                ]}
              />
              <div>
                <p className="mb-1.5 text-[13px] font-medium">What changed</p>
                {details.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No details were recorded.</p>
                ) : (
                  <>
                    {changes.length ? (
                      <dl className="mb-3 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-[max-content_1fr]">
                        {changes.map((change) => (
                          <div key={change.label} className="contents">
                            <dt className="text-muted-foreground">{change.label}</dt>
                            <dd className="min-w-0 break-words">
                              {change.before !== undefined ? (
                                <>
                                  <span className="text-muted-foreground line-through decoration-muted-foreground/50">{change.before}</span>
                                  <span aria-label="changed to" className="mx-1.5 text-muted-foreground">
                                    →
                                  </span>
                                </>
                              ) : null}
                              {change.after}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    <details open={changes.length === 0}>
                      <summary className="cursor-pointer text-xs text-muted-foreground">Raw details</summary>
                      <pre className="mt-1.5 max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    </details>
                  </>
                )}
                <p className="mt-1.5 text-xs text-muted-foreground">Secrets, tokens and keys are replaced with [redacted] before they leave the gateway.</p>
              </div>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
