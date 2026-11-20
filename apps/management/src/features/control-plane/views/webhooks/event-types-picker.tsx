"use client";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorPanel } from "@/components/patterns/notices";
import { ALL_EVENT_TYPES, toggleEventType, type EventTypeDefinition, type EventTypeSelection } from "../../model/event-types";

/**
 * Which payment events a webhook receives: all of them (including types added later), or a chosen subset.
 * The console's test event always reaches the endpoint.
 */
export function EventTypesPicker({
  catalogue,
  loading,
  error,
  selection,
  onChange,
  problem,
  idPrefix,
}: {
  catalogue: EventTypeDefinition[];
  loading: boolean;
  error: Error | null;
  selection: EventTypeSelection;
  onChange: (next: EventTypeSelection) => void;
  problem?: string;
  idPrefix: string;
}) {
  const chosen = new Set(selection.all ? [] : selection.types);
  const option = "flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-[13px] has-checked:border-foreground/40 has-checked:bg-muted/60";
  return (
    <fieldset className="flex flex-col gap-1.5" aria-describedby={problem ? `${idPrefix}-problem` : undefined}>
      <legend className="mb-1.5 text-[13px] font-medium">Events</legend>
      <label className={option}>
        <input type="radio" name={`${idPrefix}-scope`} className="mt-0.5 accent-foreground" checked={selection.all} onChange={() => onChange(ALL_EVENT_TYPES)} />
        <span>
          <span className="block font-medium">All event types</span>
          <span className="block text-xs text-muted-foreground">Including types APICenter adds later.</span>
        </span>
      </label>
      <label className={option}>
        <input
          type="radio"
          name={`${idPrefix}-scope`}
          className="mt-0.5 accent-foreground"
          checked={!selection.all}
          disabled={catalogue.length === 0}
          onChange={() => onChange({ all: false, types: [] })}
        />
        <span>
          <span className="block font-medium">Only the types I choose</span>
          <span className="block text-xs text-muted-foreground">Other events are acknowledged and dropped, never delivered.</span>
        </span>
      </label>
      {!selection.all ? (
        <div className="ml-6 flex flex-col gap-1">
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : error ? (
            <ErrorPanel title="The event types could not be loaded" error={error} />
          ) : (
            catalogue.map((entry) => (
              <label key={entry.type} className="flex cursor-pointer items-start gap-2.5 rounded-md px-1 py-1.5 text-[13px] hover:bg-muted/60">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-foreground"
                  checked={chosen.has(entry.type)}
                  onChange={() => onChange(toggleEventType(selection, entry.type, catalogue))}
                />
                <span className="min-w-0">
                  <span className="block font-medium">{entry.title}</span>
                  <span className="block font-mono text-xs break-all text-muted-foreground">{entry.type}</span>
                </span>
              </label>
            ))
          )}
        </div>
      ) : null}
      {problem ? (
        <p id={`${idPrefix}-problem`} role="alert" className="text-xs text-danger">
          {problem}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Test events (<span className="font-mono">webhook.test</span>) are always delivered.
      </p>
    </fieldset>
  );
}
