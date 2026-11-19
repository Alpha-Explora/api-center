"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { ErrorPanel } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { controlPlane } from "../../data/control-plane-repository";
import { environmentWriteReason } from "../../model/access";
import type { Capability } from "../../model/control-plane";
import { RequireEnvironment, useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";

export function CapabilitiesPage() {
  return (
    <RequireEnvironment>
      <CapabilitiesList />
    </RequireEnvironment>
  );
}

function CapabilitiesList() {
  const { organizationId, project, kind, environment, canWrite } = useProjectEnvironment();
  const client = useQueryClient();
  const catalog = useQuery({ queryKey: cpKeys.catalog, queryFn: controlPlane.capabilities, staleTime: 5 * 60_000 });
  const [pending, setPending] = useState<{ capability: Capability; on: boolean } | null>(null);
  const toggle = useMutation({
    mutationFn: (input: { capability: string; on: boolean }) => controlPlane.setCapability(organizationId, project.id, kind, input.capability, input.on),
    onSuccess: (_, input) => {
      toast.success(`${input.on ? "Enabled" : "Disabled"} ${input.capability} in ${kind}`);
      setPending(null);
      void client.invalidateQueries({ queryKey: cpKeys.project(organizationId, project.id) });
    },
    onError: (error: Error) => {
      setPending(null);
      toast.error(error.message);
    },
  });
  const enabled = new Set(environment?.capabilities.filter((entry) => entry.status === "enabled").map((entry) => entry.capability));

  function request(capability: Capability, on: boolean) {
    // Turning something off, or anything in live, is confirmed; enabling in test is immediate.
    if (kind === "live" || !on) setPending({ capability, on });
    else toggle.mutate({ capability: capability.id, on });
  }

  return (
    <>
      <PageHeader
        title="Capabilities"
        description="Shared services this environment may use. Enabling one grants no application access; grant actions per application."
      />
      {catalog.error ? <ErrorPanel title="The capability catalogue could not be loaded" error={catalog.error} /> : null}
      <Panel flush>
        {catalog.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (
          <ul className="divide-y">
            {(catalog.data ?? []).map((capability) => {
              const on = enabled.has(capability.id);
              return (
                <li key={capability.id} className="flex items-center gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium">{capability.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{capability.id}</span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {capability.actions.length} action{capability.actions.length === 1 ? "" : "s"}: {capability.actions.map((action) => action.action).join(", ")}
                    </p>
                  </div>
                  <StatusBadge tone={on ? "success" : "neutral"} className="hidden sm:inline-flex">
                    {on ? "Enabled" : "Off"}
                  </StatusBadge>
                  {canWrite ? (
                    <Switch
                      aria-label={`${on ? "Disable" : "Enable"} ${capability.name}`}
                      checked={on}
                      disabled={toggle.isPending}
                      onCheckedChange={(next) => request(capability, next)}
                    />
                  ) : (
                    <Tooltip>
                      <TooltipTrigger render={<span tabIndex={0} className="inline-flex" />}>
                        <Switch aria-label={`${capability.name} is ${on ? "enabled" : "off"}`} checked={on} disabled />
                      </TooltipTrigger>
                      <TooltipContent>{environmentWriteReason(kind)}</TooltipContent>
                    </Tooltip>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => !next && setPending(null)}
        title={pending ? `${pending.on ? "Enable" : "Disable"} ${pending.capability.name} in ${kind}` : ""}
        description={
          pending?.on
            ? "Applications still need explicit grants before they can call it."
            : "Every application in this environment is refused its actions from the next request. Grants are kept."
        }
        confirmLabel={pending?.on ? "Enable" : "Disable"}
        destructive={pending ? !pending.on : false}
        busy={toggle.isPending}
        onConfirm={() => pending && toggle.mutate({ capability: pending.capability.id, on: pending.on })}
      />
    </>
  );
}
