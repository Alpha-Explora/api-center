"use client";

import { useState } from "react";
import { RotateCcwIcon } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  previewApiCenterDeploymentRestart,
  restartApiCenterDeployment,
  type OperationPreview,
} from "@/lib/api-center-client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { OperationPreviewPanel } from "@/components/operation-preview-panel";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function DeploymentRestartCard({
  enabled,
  namespace,
  deployment,
}: {
  enabled: boolean;
  namespace: string;
  deployment: string;
}) {
  const [open, setOpen] = useState(false);
  const [operationPreview, setOperationPreview] =
    useState<OperationPreview | null>(null);
  const [typedPhrase, setTypedPhrase] = useState("");
  const [operatorReason, setOperatorReason] = useState("");
  const restartMutation = useMutation({
    mutationFn: () =>
      restartApiCenterDeployment({
        confirmation: {
          typedPhrase,
          reason: operatorReason,
        },
      }),
    onSuccess: () => {
      setOpen(false);
      toast.success("API Center rollout restarted");
    },
    onError: () => {
      toast.error("Restart failed", {
        description: "Check rollout permission, kubectl access, and local settings.",
      });
    },
  });
  const previewMutation = useMutation({
    mutationFn: previewApiCenterDeploymentRestart,
    onSuccess: (preview) => {
      setOperationPreview(preview);
      toast.success("Restart preview loaded");
    },
    onError: () => {
      toast.error("Restart preview failed", {
        description: "Check management auth and deployment settings.",
      });
    },
  });
  const result = restartMutation.data;
  const isLive = process.env.NEXT_PUBLIC_MANAGEMENT_ENV === "live";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RotateCcwIcon data-icon="inline-start" />
          API Center deployment
        </CardTitle>
        <CardDescription>
          Local-only rollout control using fixed kubectl arguments.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <RuntimeDetail label="Namespace" value={namespace} />
          <RuntimeDetail label="Deployment" value={deployment} />
          <RuntimeDetail label="Restart action" value={enabled ? "Enabled" : "Disabled"} />
        </dl>

        {!enabled ? (
          <Alert>
            <AlertTitle>Restart disabled</AlertTitle>
            <AlertDescription>
              Set `ALLOW_DEPLOYMENT_RESTARTS=true` in the server environment when you want
              the local console to run a rollout restart.
            </AlertDescription>
          </Alert>
        ) : null}

        {result ? (
          <Alert>
            <AlertTitle>Last restart</AlertTitle>
            <AlertDescription>
              Revision {result.revision ?? "unknown"} at{" "}
              {new Date(result.restartedAt).toLocaleString()}.{" "}
              {result.statusOutput}
            </AlertDescription>
          </Alert>
        ) : null}

        <OperationPreviewPanel
          title="Deployment restart preview"
          description="Preview the kubectl rollout restart before running it."
          preview={operationPreview}
          live={isLive}
          typedPhrase={typedPhrase}
          reason={operatorReason}
          previewPending={previewMutation.isPending}
          onPreview={() => previewMutation.mutate()}
          onTypedPhraseChange={setTypedPhrase}
          onReasonChange={setOperatorReason}
        />

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button disabled={!enabled} />}>
            <RotateCcwIcon data-icon="inline-start" />
            Restart deployment
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Restart API Center deployment?</DialogTitle>
              <DialogDescription>
                This runs `kubectl -n {namespace} rollout restart
                deployment/{deployment}` and waits for rollout status.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button
                onClick={() => restartMutation.mutate()}
                disabled={restartMutation.isPending}
              >
                Confirm restart
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

function RuntimeDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
