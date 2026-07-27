"use client";

import { useState } from "react";
import { ClipboardIcon } from "lucide-react";
import { toast } from "sonner";
import {
  buildAccessReviewEvidence,
  formatAccessReviewEvidenceExport,
} from "@/lib/access-review";
import { copyTextToClipboard } from "@/lib/client-clipboard";
import type {
  ServiceRegistryEntry,
  SharedServiceRuntimeUsage,
  SharedServiceUsageWindow,
} from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

export function AccessReviewPanel({
  services,
  runtimeUsage,
  window,
}: {
  services: ServiceRegistryEntry[];
  runtimeUsage: SharedServiceRuntimeUsage[];
  window: SharedServiceUsageWindow;
}) {
  const [manualCopy, setManualCopy] = useState(false);
  const evidence = buildAccessReviewEvidence({
    services,
    runtimeUsage,
    window,
  });
  const exportJson = formatAccessReviewEvidenceExport(evidence);

  async function copyEvidence() {
    const copied = await copyTextToClipboard(exportJson);
    setManualCopy(!copied);
    if (copied) {
      toast.success("Access review evidence copied");
      return;
    }
    toast.error("Copy was blocked", {
      description: "Select the evidence JSON manually and copy it.",
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <CardTitle>Access review evidence</CardTitle>
          <CardDescription>
            Ownership, declared shared-service access, scopes, usage, denied
            attempts, and unused access warnings.
          </CardDescription>
        </div>
        <Button type="button" variant="outline" onClick={copyEvidence}>
          <ClipboardIcon data-icon="inline-start" />
          Copy evidence
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-4">
          <Signal label="Tribes" value={evidence.summary.tribeCount} />
          <Signal label="Access grants" value={evidence.summary.accessGrantCount} />
          <Signal
            label="Unused access"
            value={evidence.summary.unusedAccessCount}
          />
          <Signal
            label="Denied attempts"
            value={evidence.summary.deniedAttemptCount}
          />
        </div>

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tribe</TableHead>
                <TableHead>Shared service</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Denied</TableHead>
                <TableHead>Review flag</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evidence.rows.map((row) => (
                <TableRow key={`${row.tribeServiceId}-${row.sharedServiceId}`}>
                  <TableCell>
                    <div className="font-medium">{row.tribeName}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {row.tribeServiceId}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {row.ownerTeam} / {row.contact}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.sharedServiceId}
                  </TableCell>
                  <TableCell className="max-w-60 break-all font-mono text-xs">
                    {row.scopes.join(", ") || "none"}
                  </TableCell>
                  <TableCell>{row.lastUsedAt ?? "not used"}</TableCell>
                  <TableCell>{row.deniedAttempts}</TableCell>
                  <TableCell>
                    {row.unusedAccess ? "unused access" : "active"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {manualCopy ? (
          <Textarea
            readOnly
            value={exportJson}
            className="min-h-48 font-mono text-xs"
            onFocus={(event) => event.currentTarget.select()}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function Signal({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/25 p-3 text-sm">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
