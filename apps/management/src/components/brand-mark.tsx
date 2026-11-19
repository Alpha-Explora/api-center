import Image from "next/image";
import { cn } from "@/lib/utils";

/** The APICenter logo. Its strokes are dark, so in dark mode it sits on a light tile to stay legible. */
export function BrandMark({ size = 24, className }: { size?: 24 | 32; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center dark:rounded-[5px] dark:bg-white",
        size === 32 ? "size-8" : "size-6",
        className,
      )}
    >
      <Image
        src="/brand/apicenter-logo-icon-v2.png"
        alt=""
        width={size}
        height={size}
        className="size-full object-contain dark:size-[85%]"
        priority
      />
    </span>
  );
}
