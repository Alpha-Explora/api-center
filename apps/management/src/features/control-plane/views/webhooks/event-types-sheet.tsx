"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ErrorPanel } from "@/components/patterns/notices";
import { eventDestinations } from "../../data/event-destinations";
import type { EventDestination } from "../../model/event-destinations";
import { eventTypesBody, selectionChanges, selectionFrom, type EventTypeSelection } from "../../model/event-types";
import { eventDestinationsKey, useEventTypeCatalogue } from "../../view-models/event-destinations";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { EventTypesPicker } from "./event-types-picker";

/** Changes which payment events a webhook receives. It takes effect within about 30 seconds. */
export function EventTypesSheet({
  destination,
  applicationName,
  onOpenChange,
}: {
  destination: EventDestination | null;
  applicationName: string;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={destination !== null} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        {destination ? <EventTypesForm key={destination.id} destination={destination} applicationName={applicationName} onDone={() => onOpenChange(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function EventTypesForm({ destination, applicationName, onDone }: { destination: EventDestination; applicationName: string; onDone: () => void }) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const client = useQueryClient();
  const catalogue = useEventTypeCatalogue();
  const [selection, setSelection] = useState<EventTypeSelection>(() => selectionFrom(destination.eventTypes ?? []));
  const [problem, setProblem] = useState<string | undefined>();
  const save = useMutation({
    mutationFn: (eventTypes: string[]) => eventDestinations.setEventTypes({ organizationId, projectId: project.id, kind }, destination.id, eventTypes),
    onSuccess: () => {
      toast.success(`Updated the events ${applicationName}'s webhook receives`);
      void client.invalidateQueries({ queryKey: eventDestinationsKey(organizationId, project.id, kind) });
      onDone();
    },
  });

  return (
    <form
      className="flex h-full flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        const body = eventTypesBody(selection);
        setProblem(body.ok ? undefined : body.error);
        if (!body.ok) return;
        if (!selectionChanges(selection, destination.eventTypes ?? [])) return onDone();
        save.mutate(body.eventTypes);
      }}
    >
      <SheetHeader>
        <SheetTitle>Events for {applicationName}</SheetTitle>
        <SheetDescription>
          Choose which payment events this webhook receives in {kind}. The change reaches the delivery service within about 30 seconds; events already
          queued are filtered the same way.
        </SheetDescription>
      </SheetHeader>
      <div className="flex flex-col gap-4 overflow-y-auto px-4">
        <EventTypesPicker
          idPrefix="edit-event-types"
          catalogue={catalogue.data ?? []}
          loading={catalogue.isLoading}
          error={catalogue.error}
          selection={selection}
          onChange={(next) => {
            setSelection(next);
            setProblem(undefined);
            save.reset();
          }}
          problem={problem}
        />
        {save.error ? <ErrorPanel title="The event types were not saved" error={save.error} /> : null}
      </div>
      <SheetFooter className="mt-auto flex-row justify-end border-t">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save events"}
        </Button>
      </SheetFooter>
    </form>
  );
}
