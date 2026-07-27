"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--popover)",
          "--success-text": "var(--foreground)",
          "--success-border": "color-mix(in srgb, var(--brand-green-deep) 28%, var(--border))",
          "--info-bg": "var(--popover)",
          "--info-text": "var(--foreground)",
          "--info-border": "color-mix(in srgb, var(--brand-green-deep) 28%, var(--border))",
          "--warning-bg": "var(--popover)",
          "--warning-text": "#7a4300",
          "--warning-border": "color-mix(in srgb, #9a5b00 36%, var(--border))",
          "--error-bg": "var(--popover)",
          "--error-text": "var(--destructive)",
          "--error-border": "color-mix(in srgb, var(--destructive) 36%, var(--border))",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast:
            "!border-border !bg-popover !text-popover-foreground shadow-[0_12px_30px_-18px_rgb(0_0_0_/_0.45)]",
          title: "!text-foreground font-semibold",
          description: "!text-foreground !opacity-100",
          icon: "!text-current",
          success: "border-[color-mix(in_srgb,var(--brand-green-deep)_28%,var(--border))]",
          info: "border-[color-mix(in_srgb,var(--brand-green-deep)_28%,var(--border))]",
          warning:
            "!text-foreground border-[color-mix(in_srgb,#9a5b00_36%,var(--border))]",
          error:
            "!text-foreground border-[color-mix(in_srgb,var(--destructive)_36%,var(--border))]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
