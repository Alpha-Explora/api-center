import { formatActor } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Who made a change: the person or script, and a quiet note when they acted through the platform credential. */
export function ActorLabel({ actor, className }: { actor: string | null | undefined; className?: string }) {
  const { name, via } = formatActor(actor);
  return (
    <span className={cn("inline-flex min-w-0 items-baseline gap-1.5", className)} title={actor ?? undefined}>
      <span className="truncate">{name}</span>
      {via ? <span className="shrink-0 text-xs text-muted-foreground">via platform</span> : null}
    </span>
  );
}
