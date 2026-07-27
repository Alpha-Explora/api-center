"use client";

import { BarChart3Icon, ExternalLinkIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type {
  NorthStarBiConfig,
  NorthStarBiProvider,
} from "@/lib/server/north-star-bi-config";

export function BiEmbedPanel({ config }: { config: NorthStarBiConfig }) {
  const providerLabel = formatProviderLabel(config.provider);

  return (
    <Card>
      <CardHeader>
        <CardTitle>BI north-star dashboard</CardTitle>
        <CardDescription>
          Governed BI view over Gold or materialized platform outputs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!config.enabled || !config.embedUrl ? (
          <Alert>
            <BarChart3Icon data-icon="inline-start" />
            <AlertTitle>BI dashboard not configured</AlertTitle>
            <AlertDescription>
              Set BI_NORTH_STAR_ENABLED=true, BI_NORTH_STAR_PROVIDER, and
              BI_NORTH_STAR_EMBED_URL after the dashboard points to governed Gold
              or materialized outputs.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="overflow-hidden rounded-lg border bg-muted">
              <iframe
                title="APICenter north-star BI dashboard"
                src={config.embedUrl}
                className="h-[720px] w-full bg-background"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allow="fullscreen"
              />
            </div>
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <ExternalLinkIcon className="size-3" />
              <span>{providerLabel}</span>
              <span aria-hidden="true">/</span>
              <span>
                Dashboard id:{" "}
                {config.dashboardId ?? "not recorded in environment"}
              </span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatProviderLabel(provider: NorthStarBiProvider) {
  if (provider === "powerbi") return "Power BI";
  if (provider === "looker") return "Looker";
  if (provider === "looker-studio") return "Looker Studio";
  return "BI provider";
}
