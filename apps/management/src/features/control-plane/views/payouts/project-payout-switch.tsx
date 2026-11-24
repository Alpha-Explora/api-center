"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { ErrorPanel } from "@/components/patterns/notices";
import { featureAccess } from "../../data/features";
import type { ProjectPayoutFeature } from "../../model/features";
import { usePayoutOverview } from "../../view-models/payouts";
import { useProjectEnvironment } from "../../view-models/project-environment";

export function ProjectPayoutSwitch({ feature, title }: { feature: ProjectPayoutFeature; title: string }) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const scope = { organizationId, projectId: project.id, kind };
  const client = useQueryClient();
  const overview = usePayoutOverview();
  const key = ["payout-project-switch", organizationId, project.id, kind, feature];
  const query = useQuery({ queryKey: key, queryFn: () => featureAccess.projectSwitch(scope, feature) });
  const [confirm, setConfirm] = useState(false);
  const update = useMutation({
    mutationFn: (enabled: boolean) => featureAccess.setProjectSwitch(scope, feature, enabled),
    onSuccess: () => {
      setConfirm(false);
      void client.invalidateQueries({ queryKey: key });
      void overview.refetch();
    },
  });
  const enabled = query.data?.enabled ?? false;
  return <div className="space-y-2">
    {query.error ? <ErrorPanel error={query.error} /> : null}
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span>{title}{query.data ? ` · ${enabled ? "Enabled" : "Off"}` : ""}</span>
      <Button size="sm" variant="outline" disabled={!query.data} onClick={() => { update.reset(); setConfirm(true); }}>
        {enabled ? "Disable" : "Enable"} for project
      </Button>
    </div>
    <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={`${enabled ? "Disable" : "Enable"} ${title.toLowerCase()}`}
      description={`This changes access for ${project.name} in ${kind}.`}
      confirmLabel={enabled ? "Disable for project" : "Enable for project"} destructive={enabled}
      busy={update.isPending} onConfirm={() => update.mutate(!enabled)}>
      {update.error ? <ErrorPanel error={update.error} /> : null}
    </ConfirmDialog>
  </div>;
}
