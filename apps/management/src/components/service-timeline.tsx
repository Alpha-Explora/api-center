import { mergeTimelineEvents, type ServiceTimelineEvent } from "@/lib/service-timeline";

type ServiceTimelineProps = {
  events: ServiceTimelineEvent[];
};

export function ServiceTimeline({ events }: ServiceTimelineProps) {
  const sortedEvents = mergeTimelineEvents(events);

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Service timeline</h2>
      <div className="space-y-2">
        {sortedEvents.length ? (
          sortedEvents.map((event) => (
            <article key={event.id} className="rounded-md border p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">{event.title}</h3>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  {event.source}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{event.occurredAt}</p>
              {event.detail ? (
                <p className="mt-2 text-sm text-muted-foreground">{event.detail}</p>
              ) : null}
            </article>
          ))
        ) : (
          <div className="rounded-md border p-3 text-sm text-muted-foreground">
            No timeline events loaded yet.
          </div>
        )}
      </div>
    </section>
  );
}
