import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** What an empty list means and what to do next. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center", className)}>
      {icon ? <div className="mb-1 text-muted-foreground [&_svg]:size-5">{icon}</div> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-md text-[13px] text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}
