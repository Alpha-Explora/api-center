"use client";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** A button that, when the person's role does not allow the action, stays visible, disabled, and says why. */
export function GuardedButton({ allowed, reason, ...props }: ComponentProps<typeof Button> & { allowed: boolean; reason: string }) {
  if (allowed) return <Button {...props} />;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex cursor-not-allowed" tabIndex={0} />}>
        <Button {...props} disabled aria-disabled onClick={undefined} />
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}
