type DriftItem = {
  severity: "warning" | "critical";
  resourceType: string;
  resourceId: string;
  ownerTribeId: string;
  message: string;
};

export function GovernanceDriftPanel({ items }: { items: DriftItem[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Governance drift</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Management and runtime governance are in sync.
        </p>
      ) : (
        <ul className="divide-y rounded-md border">
          {items.map((item) => (
            <li
              className="p-3 text-sm"
              key={`${item.resourceType}:${item.resourceId}`}
            >
              <div className="font-medium">{item.ownerTribeId}</div>
              <div className="text-muted-foreground">{item.message}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
