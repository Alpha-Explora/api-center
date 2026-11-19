"use client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { IdText } from "@/components/patterns/copy-button";
import { DescriptionList } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDateTime, formatRelative } from "@/lib/format";
import { auditActionLabel, type AuditEntry } from "../../model/observability";

/** Audit events as a table. `projectName` resolves project IDs; `showProject` adds the project column. */
export function AuditTable({
  entries,
  onSelect,
  projectName,
  showProject = true,
}: {
  entries: AuditEntry[];
  onSelect: (entry: AuditEntry) => void;
  projectName?: (projectId: string) => string | undefined;
  showProject?: boolean;
}) {
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
        {entries.map((entry) => (
          <TableRow key={entry.id} className="cursor-pointer" onClick={() => onSelect(entry)}>
            <TableCell className="max-w-64 whitespace-normal">
              <button
                type="button"
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-left hover:underline focus-visible:underline focus-visible:outline-none"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(entry);
                }}
              >
                <span className="font-medium">{auditActionLabel(entry.action)}</span>
                {entry.environment ? <EnvironmentTag kind={entry.environment} /> : null}
                {entry.outcome !== "succeeded" ? <StatusBadge status={entry.outcome} /> : null}
              </button>
              <div className="truncate text-xs text-muted-foreground sm:hidden">{entry.actor ?? "System"}</div>
            </TableCell>
            <TableCell className="hidden max-w-56 truncate sm:table-cell">{entry.actor ?? <span className="text-muted-foreground">System</span>}</TableCell>
            {showProject ? (
              <TableCell className="hidden max-w-48 truncate md:table-cell">
                {entry.projectId ? (
                  (projectName?.(entry.projectId) ?? <span className="font-mono text-xs">{entry.projectId}</span>)
                ) : (
                  <span className="text-muted-foreground">Organization</span>
                )}
              </TableCell>
            ) : null}
            <TableCell className="text-right whitespace-nowrap text-muted-foreground" title={formatDateTime(entry.occurredAt)}>
              {formatRelative(entry.occurredAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
  onOpenChange,
}: {
  entry: AuditEntry | null;
  projectName?: (projectId: string) => string | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const details = entry ? Object.entries(entry.details) : [];
  return (
    <Sheet open={entry !== null} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        {entry ? (
          <>
            <SheetHeader>
              <SheetTitle>{auditActionLabel(entry.action)}</SheetTitle>
              <SheetDescription>
                {formatDateTime(entry.occurredAt)} by {entry.actor ?? "the system"}
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
                  { label: "Actor", value: entry.actor ?? "System" },
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
                <p className="mb-1.5 text-[13px] font-medium">Details</p>
                {details.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">No details were recorded.</p>
                ) : (
                  <pre className="max-h-80 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {JSON.stringify(entry.details, null, 2)}
                  </pre>
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
