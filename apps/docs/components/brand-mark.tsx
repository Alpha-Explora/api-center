/** The APICenter logo, as in the console. Its strokes are dark, so in dark mode it sits on a light tile. */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center dark:rounded-[5px] dark:bg-white"
      style={{ width: size, height: size }}
    >
      {/* The site is a static export, so the logo is a plain image rather than next/image. */}
      <img src="/brand/apicenter-logo-icon-v2.png" alt="" width={size} height={size} className="size-full object-contain dark:size-[85%]" />
    </span>
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
