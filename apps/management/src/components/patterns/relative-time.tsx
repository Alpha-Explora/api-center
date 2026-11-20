import { formatDateTime, formatRelative } from "@/lib/format";

/** "16 minutes ago", with the exact date and time on hover and for assistive technology. */
export function RelativeTime({ value, className }: { value: string | Date | null | undefined; className?: string }) {
  if (!value) return <span className={className}>—</span>;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return <span className={className}>—</span>;
  return (
    <time dateTime={date.toISOString()} title={formatDateTime(date)} className={className}>
      {formatRelative(date)}
    </time>
  );
}
