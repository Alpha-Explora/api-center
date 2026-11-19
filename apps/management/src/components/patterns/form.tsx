import type { ComponentProps, ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** A labelled form row with optional help text and error. */
export function FormRow({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** A native select styled like the console's inputs; native keeps forms and tests simple. */
export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex w-full", className)}>
      <select
        className="h-8 w-full appearance-none rounded-md border border-input bg-card py-1 pr-8 pl-2.5 text-[13px] shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/20"
        {...props}
      >
        {children}
      </select>
      <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border bg-muted px-1 font-sans text-[11px] font-medium text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
