"use client";

import { ClipboardIcon } from "lucide-react";
import { toast } from "sonner";
import { copyTextToClipboard } from "@/lib/client-clipboard";
import {
  getOnboardingChecks,
  getOnboardingPacket,
} from "@/lib/service-onboarding";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ServiceRegistryEntry } from "@/lib/schemas";

export function OnboardingChecklistPanel({
  service,
  services,
}: {
  service: ServiceRegistryEntry;
  services: ServiceRegistryEntry[];
}) {
  const checks = getOnboardingChecks(service, services);
  const packet = getOnboardingPacket(service, services);

  async function copyPacket() {
    const copied = await copyTextToClipboard(JSON.stringify(packet, null, 2));
    if (copied) {
      toast.success("Onboarding packet copied");
      return;
    }

    toast.error("Copy was blocked", {
      description: "Use the manifest export panel to select and copy manually.",
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Onboarding checklist</CardTitle>
          <CardDescription>
            Checks to run before a tribe starts using this service.
          </CardDescription>
        </div>
        <Button variant="outline" onClick={copyPacket}>
          <ClipboardIcon data-icon="inline-start" />
          Copy packet
        </Button>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-2">
        {checks.map((check) => (
          <div
            key={check.key}
            className="flex items-start justify-between gap-3 rounded-lg border p-3"
          >
            <div className="flex flex-col gap-1">
              <span className="font-medium">{check.label}</span>
              <span className="text-sm text-muted-foreground">
                {check.detail}
              </span>
            </div>
            <Badge variant={check.ok ? "secondary" : "destructive"}>
              {check.ok ? "ready" : "fix"}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
