import type { EventDefinition } from "@/lib/contracts";

export function EventReference({ events }: { events: EventDefinition[] }) {
  return (
    <section className="event-list" aria-label="Payment event reference">
      {events.map((event) => (
        <article className="event-row" key={event.name}>
          <div>
            <code className="event-name">{event.name}</code>
            <h3>{event.title}</h3>
          </div>
          <div>
            <p>{event.description}</p>
            <span className="tag">aggregate: {event.aggregateType}</span>
          </div>
        </article>
      ))}
    </section>
  );
}