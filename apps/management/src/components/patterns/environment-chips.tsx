import { StatusBadge, statusLabel, statusTone } from "@/components/patterns/status-badge";

/** A project's environments at a glance: "Test", "Live · Provisioning", or "No live" when it has none. */
export function EnvironmentChips({ environments }: { environments: { kind: string; status: string }[] }) {
  const ordered = ["test", "live"].map((kind) => environments.find((environment) => environment.kind === kind));
  return (
    <div className="flex flex-wrap gap-1">
      {ordered.map((environment, index) =>
        environment ? (
          <StatusBadge key={environment.kind} tone={statusTone(environment.status)}>
            {environment.kind === "live" ? "Live" : "Test"}
            {environment.status !== "active" ? ` · ${statusLabel(environment.status)}` : ""}
          </StatusBadge>
        ) : index === 1 ? (
          <span key="no-live" className="inline-flex h-5 items-center text-xs text-muted-foreground">
            No live
          </span>
        ) : null,
      )}
    </div>
  );
}
