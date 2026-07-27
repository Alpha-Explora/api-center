import Link from "next/link";

type DependencyEdge = { from: string; to: string; type: string };

export function RuntimeDependencyMapPanel({
  edges,
}: {
  edges: DependencyEdge[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Runtime dependency map</h2>
      <div className="rounded-md border">
        {edges.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            No runtime dependencies reported.
          </p>
        ) : (
          edges.map((edge) => (
            <div
              className="grid grid-cols-[1fr_auto_1fr] gap-3 border-b p-3 text-sm last:border-b-0"
              key={`${edge.from}:${edge.to}:${edge.type}`}
            >
              <DependencyEndpoint id={edge.from} />
              <span className="text-muted-foreground">{edge.type}</span>
              <DependencyEndpoint id={edge.to} />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function DependencyEndpoint({ id }: { id: string }) {
  if (!isServiceLikeDependencyId(id)) {
    return <span>{id}</span>;
  }

  return (
    <Link
      href={`/tribes/${encodeURIComponent(id)}?section=dependencies`}
      className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
    >
      {id}
    </Link>
  );
}

function isServiceLikeDependencyId(id: string) {
  return id !== "kafka" && !/^tribe\..+\.events$/i.test(id);
}
