"use client";
import { useId, useState } from "react";
import { formatNumber } from "@/lib/format";
import { bucketLabel, niceCeiling, type UsageSeries } from "../../model/observability";

const PLOT_HEIGHT = 140;
/** Share of each bucket's slot left empty on both sides of its bar. */
const SLOT_PADDING = 0.18;
const FAILED_GAP = 2;

/**
 * Requests per bucket as thin bars on one axis; failed requests are the bar's lower segment in the danger
 * color, separated by a 2px surface gap. Hover or focus a bucket for its counts.
 */
export function UsageChart({ usage }: { usage: UsageSeries }) {
  const clipId = useId();
  const [active, setActive] = useState<number | null>(null);
  const max = niceCeiling(Math.max(...usage.series.map((point) => point.requests), 0));
  const slot = 100 / usage.series.length;
  const scale = (value: number) => (value / max) * PLOT_HEIGHT;
  const hovered = active === null ? undefined : usage.series[active];
  const labelEvery = usage.series.length > 12 ? Math.ceil(usage.series.length / 6) : 1;

  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="sr-only">
        Requests per {usage.bucket} over the last {usage.range}: {formatNumber(usage.totals.requests)} in total, {formatNumber(usage.totals.failed)} failed.
      </figcaption>
      <div className="flex gap-2">
        <div
          className="flex w-8 shrink-0 flex-col justify-between text-right text-[11px] leading-none text-muted-foreground tabular-nums"
          style={{ height: PLOT_HEIGHT }}
          aria-hidden
        >
          <span>{compact(max)}</span>
          <span>{compact(max / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <svg width="100%" height={PLOT_HEIGHT} role="img" aria-label={`Requests per ${usage.bucket}`} className="block overflow-visible">
            <defs>
              <clipPath id={clipId}>
                <rect x="0" y="0" width="100%" height={PLOT_HEIGHT} />
              </clipPath>
            </defs>
            {[0, 0.5].map((fraction) => (
              <line
                key={fraction}
                x1="0"
                x2="100%"
                y1={PLOT_HEIGHT * fraction + 0.5}
                y2={PLOT_HEIGHT * fraction + 0.5}
                className="stroke-border"
                strokeDasharray="2 3"
              />
            ))}
            <line x1="0" x2="100%" y1={PLOT_HEIGHT - 0.5} y2={PLOT_HEIGHT - 0.5} className="stroke-border" />
            <g clipPath={`url(#${clipId})`}>
              {usage.series.map((point, index) => {
                const x = `${index * slot + slot * SLOT_PADDING}%`;
                const width = `${slot * (1 - 2 * SLOT_PADDING)}%`;
                const failedHeight = point.failed > 0 ? Math.max(2, scale(point.failed)) : 0;
                const okHeight = scale(point.requests - point.failed) - (failedHeight ? FAILED_GAP : 0);
                const dim = active !== null && active !== index;
                return (
                  <g key={point.start} opacity={dim ? 0.45 : 1}>
                    {okHeight > 0 ? (
                      // Extends 4px below its base so only the top corners show rounded.
                      <rect
                        x={x}
                        width={width}
                        y={PLOT_HEIGHT - failedHeight - (failedHeight ? FAILED_GAP : 0) - Math.max(okHeight, 1)}
                        height={Math.max(okHeight, 1) + 4}
                        rx={2}
                        className="fill-foreground/70"
                      />
                    ) : null}
                    {failedHeight > 0 ? (
                      <rect x={x} width={width} y={PLOT_HEIGHT - failedHeight} height={failedHeight + 4} rx={2} className="fill-danger" />
                    ) : null}
                  </g>
                );
              })}
            </g>
            {usage.series.map((point, index) => (
              <rect
                key={point.start}
                x={`${index * slot}%`}
                width={`${slot}%`}
                y={0}
                height={PLOT_HEIGHT}
                fill="transparent"
                tabIndex={0}
                aria-label={`${bucketLabel(point.start, usage.bucket)}: ${point.requests} requests, ${point.failed} failed`}
                className="outline-none"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
              />
            ))}
          </svg>
          {hovered && active !== null ? (
            <div
              role="status"
              className="pointer-events-none absolute -top-2 z-10 -translate-y-full rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
              style={{
                left: `clamp(0px, calc(${(active + 0.5) * slot}% - 4.5rem), calc(100% - 9rem))`,
                width: "9rem",
              }}
            >
              <p className="font-medium">{bucketTitle(hovered.start, usage.bucket)}</p>
              <p className="mt-0.5 flex justify-between tabular-nums">
                <span className="text-muted-foreground">Requests</span> {formatNumber(hovered.requests)}
              </p>
              <p className="flex justify-between tabular-nums">
                <span className="text-muted-foreground">Failed</span> {formatNumber(hovered.failed)}
              </p>
            </div>
          ) : null}
          <div className="relative mt-1.5 h-3 text-[11px] leading-none text-muted-foreground" aria-hidden>
            {usage.series.map((point, index) =>
              // Anchored on the current bucket and evenly spaced back from it.
              (usage.series.length - 1 - index) % labelEvery === 0 ? (
                <span key={point.start} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${(index + 0.5) * slot}%` }}>
                  {bucketLabel(point.start, usage.bucket)}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4 pl-10 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-xs bg-foreground/70" /> Completed or in flight
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2 rounded-xs bg-danger" /> Failed
        </span>
        <span className="ml-auto">UTC</span>
      </div>
    </figure>
  );
}

function compact(value: number) {
  return value >= 1000 ? `${Number((value / 1000).toFixed(1))}k` : String(Math.round(value));
}

function bucketTitle(start: string, bucket: "hour" | "day") {
  const date = new Date(start);
  const day = date.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return bucket === "hour" ? `${day}, ${bucketLabel(start, bucket)} UTC` : `${day} (UTC)`;
}
