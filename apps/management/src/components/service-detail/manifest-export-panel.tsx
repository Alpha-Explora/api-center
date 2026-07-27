"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { CopyIcon } from "lucide-react";
import { copyTextToClipboard } from "@/lib/client-clipboard";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { ServiceRegistryEntry } from "@/lib/schemas";

export function ManifestExportPanel({
  service,
}: {
  service: ServiceRegistryEntry;
}) {
  const [manualCopy, setManualCopy] = useState(false);
  const manifestJson = JSON.stringify(service, null, 2);

  async function copyManifest() {
    const copied = await copyTextToClipboard(manifestJson);
    if (copied) {
      setManualCopy(false);
      toast.success("Manifest copied");
      return;
    }

    setManualCopy(true);
    toast.error("Copy was blocked", {
      description: "Select the manifest text and copy it manually.",
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manifest export</CardTitle>
        <CardDescription>
          Copy the current registry entry for review, backup, or manifest import.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          readOnly
          value={manifestJson}
          className="min-h-64 font-mono text-xs"
          onFocus={(event) => event.currentTarget.select()}
        />
        {manualCopy ? (
          <p className="text-xs text-destructive">
            Copy was blocked by the browser. Select the manifest text above and
            copy it manually.
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={copyManifest}>
            <CopyIcon data-icon="inline-start" />
            Copy manifest
          </Button>
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href={`/tribes/${service.serviceId}/edit`} />}
          >
            Edit manifest
          </Button>
          <Button
            nativeButton={false}
            variant="outline"
            render={<Link href="/manifest-tools" />}
          >
            Open manifest tools
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
