"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ComingSoonBadge } from "@/components/patterns/coming-soon";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { featureAccess } from "@/features/control-plane/data/features";
import { approvalChange, featureAccessState, type FeatureChange, type FeatureKey, type FeatureScope } from "@/features/control-plane/model/features";
import { cpKeys } from "@/features/control-plane/view-models/query-keys";
import { useOrganization } from "@/features/control-plane/view-models/use-organization";
import { useProjectEnvironment } from "@/features/control-plane/view-models/project-environment";

const featureQueryKey = (scope: FeatureScope) => ["features", scope.organizationId, scope.projectId, scope.kind];

export function useFeaturePrompt(scope: FeatureScope) {
  const [requested, setRequested] = useState<FeatureChange | null>(null);
  return {
    handle(error: unknown, change: Record<string, unknown>) {
      const request = approvalChange(error, change);
      if (request) setRequested(request);
      return request !== null;
    },
    dialog: requested ? <FeatureRequestDialog scope={scope} change={requested} close={() => setRequested(null)} /> : null,
  };
}

function FeatureRequestDialog({ scope, change, title, close }: {
  scope: FeatureScope; change: FeatureChange; title?: string; close: () => void;
}) {
  const client = useQueryClient();
  const request = useMutation({
    mutationFn: (reason: string) => featureAccess.request(scope, { ...change, reason }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: featureQueryKey(scope) });
      void client.invalidateQueries({ queryKey: cpKeys.approvalsRoot });
      toast.success("Request sent to APICenter");
      close();
    },
  });
  return <ConfirmDialog open onOpenChange={(open) => { if (!open) close(); }}
    title={title ? `Request ${title.toLowerCase()}` : "Request feature access"}
    description="APICenter will review this change for your project."
    confirmLabel="Send request" reasonLabel="Why do you need this change?" busy={request.isPending} onConfirm={(reason) => request.mutate(reason)}>
    {request.error ? <ErrorPanel error={request.error} /> : null}
  </ConfirmDialog>;
}

export function FeatureAccess({ feature, fallback, requestAccess = true }: {
  feature: FeatureKey; fallback?: boolean; requestAccess?: boolean;
}) {
  const { organizationId, project, kind, canWrite } = useProjectEnvironment();
  const { session } = useOrganization();
  const scope = { organizationId, projectId: project.id, kind };
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const queryKey = featureQueryKey(scope);
  const query = useQuery({ queryKey, queryFn: () => featureAccess.list(scope), staleTime: 30_000 });
  const cancel = useMutation({
    mutationFn: (id: string) => featureAccess.cancel(scope, id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey });
      void client.invalidateQueries({ queryKey: cpKeys.approvalsRoot });
    },
  });
  const view = query.data?.find((row) => row.key === feature);
  if (!view) return fallback ? <ComingSoonBadge /> : null;
  const state = featureAccessState(view);
  if (state === "not_offered" || (state === "coming_soon" && !view.paused)) return <ComingSoonBadge />;
  return <div className="flex flex-wrap items-center gap-2 text-[13px]">
    {view.paused ? <Notice title="Paused by APICenter" /> : null}
    {view.pending ? <>
      <span>Pending approval from APICenter</span>
      {canWrite && session?.email === view.pending.requestedBy
        ? <Button type="button" variant="ghost" size="sm" onClick={() => view.pending && cancel.mutate(view.pending.id)} disabled={cancel.isPending}>
            Cancel request
          </Button> : null}
      {cancel.error ? <ErrorPanel error={cancel.error} /> : null}
    </> : null}
    {view.last?.status === "rejected" && !view.pending && view.last.decisionNote ? <span>Rejected · {view.last.decisionNote}</span> : null}
    {requestAccess && canWrite && !view.pending && view.release !== "coming_soon"
      ? <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>Request access</Button> : null}
    {open ? <FeatureRequestDialog scope={scope} change={{ feature, change: {} }} title={view.title} close={() => setOpen(false)} /> : null}
  </div>;
}
