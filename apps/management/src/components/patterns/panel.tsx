import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A bordered section with a compact header. With `flush`, tables and lists inside run edge to edge. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  flush = false,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={cn("overflow-hidden rounded-lg border bg-card", className)}>
      {title || actions ? (
        <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            {title ? <h2 className="text-sm font-semibold">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? undefined : "p-4"}>{children}</div>
    </section>
  );
}

/** Label/value rows for an object's properties. */
export function DescriptionList({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid gap-x-8 gap-y-2.5 text-[13px] sm:grid-cols-[max-content_1fr]", className)}>
      {items.map((item, index) => (
        <div key={index} className="contents">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0 break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
