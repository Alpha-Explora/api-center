import { useId } from "react";

const LANE_RADII = [30, 21.5, 13];
const LANE_OPACITY = [1, 0.7, 0.42];

/**
 * The APICenter logo, as in the console: three lanes form a gateway and one emerald request passes through.
 * The lanes take the text color, so the mark works in light and dark mode.
 */
export function BrandMark({ size = 24 }: { size?: number }) {
  // SVG ids are document-wide, so each mark needs its own gradient and filter ids.
  const id = useId().replace(/[^\w-]/g, "");
  return (
    <svg aria-hidden viewBox="14 17 72 72" width={size} height={size} className="shrink-0">
      <defs>
        <radialGradient id={`${id}-core`} cx=".35" cy=".3" r=".8">
          <stop offset="0" stopColor="#a7f3d0" />
          <stop offset=".55" stopColor="#34d399" />
          <stop offset="1" stopColor="#059669" />
        </radialGradient>
        <filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <g fill="none" stroke="currentColor" strokeWidth={5.5} strokeLinecap="round">
        {LANE_RADII.map((r, i) => (
          <path key={r} d={`M${50 - r} 84V52a${r} ${r} 0 0 1 ${2 * r} 0V84`} strokeOpacity={LANE_OPACITY[i]} />
        ))}
      </g>
      <circle cx="50" cy="66" r="9" fill="#34d399" opacity={0.55} filter={`url(#${id}-glow)`} />
      <circle cx="50" cy="66" r="6" fill={`url(#${id}-core)`} />
    </svg>
  );
}

/** The logo and product name, for the navbar and the docs sidebar. */
export function BrandTitle() {
  return (
    <span className="inline-flex items-center gap-2 text-[15px] font-semibold tracking-tight">
      <BrandMark size={22} />
      APICenter
      <span className="font-normal text-fd-muted-foreground">Docs</span>
    </span>
  );
}
