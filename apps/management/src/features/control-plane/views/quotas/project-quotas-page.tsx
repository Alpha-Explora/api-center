"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GaugeIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { EmptyState } from "@/components/patterns/empty-state";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { Panel } from "@/components/patterns/panel";
import { quotas } from "../../data/quotas";
import { PROJECT_ADMIN_REASON } from "../../model/access";
import { EMPTY_QUOTA_FORM, policiesForEnvironment, quotaFormToBody, type QuotaForm, type QuotaFormErrors, type QuotaPolicy } from "../../model/quotas";
import { RequireEnvironment, useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";
import { QUOTA_LIMITATIONS, QUOTA_RULES, QuotaPolicyFields, QuotaPolicyTable, statusChangeCopy } from "./quota-parts";

export function ProjectQuotasPage() {
  return (
    <RequireEnvironment>
      <ProjectQuotas />
    </RequireEnvironment>
  );
}

function ProjectQuotas() {
  const { organizationId, project, kind, access, canManage } = useProjectEnvironment();
  const client = useQueryClient();
  const key = [...cpKeys.project(organizationId, project.id), "quota-policies"];
  const policies = useQuery({ queryKey: key, queryFn: () => quotas.projectPolicies(organizationId, project.id), retry: false });
  const [creating, setCreating] = useState(false);
  const [changing, setChanging] = useState<QuotaPolicy | null>(null);
  const setStatus = useMutation({
    mutationFn: (policy: QuotaPolicy) => quotas.setStatus(organizationId, policy.id, policy.status === "active" ? "disabled" : "active"),
    onSuccess: (updated) => {
      toast.success(updated.status === "active" ? "Policy enabled" : "Policy disabled");
      setChanging(null);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const { project: own, shared } = policiesForEnvironment(policies.data ?? [], kind);
  const copy = statusChangeCopy(changing);
  const label = kind === "live" ? "Live" : "Test";

  return (
    <>
      <PageHeader
        title="Quotas"
        description={`Request limits for ${project.name} in ${kind}, on top of the plan's daily allowance.`}
        actions={
          <GuardedButton allowed={canManage} reason={PROJECT_ADMIN_REASON} onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" /> New policy
          </GuardedButton>
        }
      />
      <Notice title="How quotas apply">
        {`${QUOTA_RULES} ${QUOTA_LIMITATIONS}`}
      </Notice>
      {policies.error ? <ErrorPanel title="Quota policies could not be loaded" error={policies.error} /> : null}

      <Panel title={`${label} project policies`} description="Each policy limits every application in this environment together." flush>
        {policies.isLoading ? (
          <LoadingRows />
        ) : own.length === 0 ? (
          <EmptyState
            icon={<GaugeIcon />}
            title={`No ${kind} policies`}
            description="Only the plan's daily allowance and shared ceilings limit this environment. Add a policy to cap a capability or a burst."
          />
        ) : (
          <QuotaPolicyTable
            policies={own}
            actions={(policy) =>
              canManage ? (
                <Button size="sm" variant="ghost" onClick={() => setChanging(policy)}>
                  {policy.status === "active" ? "Disable" : "Enable"}
                </Button>
              ) : null
            }
          />
        )}
      </Panel>

      <Panel
        title="Shared ceilings"
        description="One budget that this project and the other covered projects draw from together. Organization owners and admins manage them."
        flush
        actions={
          access.canManageQuotas ? (
            <Link href="/quotas" className="text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Manage on Quotas
            </Link>
          ) : null
        }
      >
        {policies.isLoading ? (
          <LoadingRows />
        ) : shared.length === 0 ? (
          <EmptyState title={`No shared ceilings cover ${kind}`} />
        ) : (
          <QuotaPolicyTable
            policies={shared}
            extra={{
              label: "Shared with",
              render: (policy) => {
                const others = (policy.coveredProjectIds ?? []).filter((id) => id !== project.id).length;
                return (
                  <span className="text-muted-foreground">
                    {others === 0 ? "Only this project" : `This project and ${others} other${others === 1 ? "" : "s"}`} · read-only here
                  </span>
                );
              },
            }}
          />
        )}
      </Panel>

      <CreateProjectPolicySheet open={creating} onOpenChange={setCreating} onCreated={() => void client.invalidateQueries({ queryKey: key })} />

      <ConfirmDialog
        open={changing !== null}
        onOpenChange={(next) => !next && setChanging(null)}
        title={`${copy.title} in ${kind}`}
        description={copy.description}
        confirmLabel={copy.confirmLabel}
        destructive={changing?.status !== "active" && changing?.mode === "enforce"}
        busy={setStatus.isPending}
        onConfirm={() => changing && setStatus.mutate(changing)}
      />
    </>
  );
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2 p-4">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  );
}

function CreateProjectPolicySheet({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const [form, setForm] = useState<QuotaForm>(EMPTY_QUOTA_FORM);
  const [errors, setErrors] = useState<QuotaFormErrors>({});
  const [confirming, setConfirming] = useState<Parameters<typeof quotas.createProjectPolicy>[2] | null>(null);
  const create = useMutation({
    mutationFn: (body: Parameters<typeof quotas.createProjectPolicy>[2]) => quotas.createProjectPolicy(organizationId, project.id, body),
    onSuccess: () => {
      toast.success(`Policy created for ${kind}`);
      close(false);
      onCreated();
    },
  });

  function close(next: boolean) {
    if (!next) {
      setForm(EMPTY_QUOTA_FORM);
      setErrors({});
      setConfirming(null);
      create.reset();
    }
    onOpenChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="sm:max-w-md">
        <form
          className="flex h-full flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const result = quotaFormToBody(form, kind);
            setErrors(result.ok ? {} : result.errors);
            if (!result.ok) return;
            // An enforcing live policy can refuse live traffic on the next request.
            if (kind === "live" && result.body.mode !== "observe") setConfirming(result.body);
            else create.mutate(result.body);
          }}
        >
          <SheetHeader>
            <SheetTitle>New {kind} quota policy</SheetTitle>
            <SheetDescription>
              Limits every application in {project.name}&apos;s {kind} environment together. It cannot be edited later, only disabled.
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-4 overflow-y-auto px-4">
            <QuotaPolicyFields form={form} onChange={setForm} errors={errors} idPrefix="project-quota" />
            {create.error ? <ErrorPanel title="The policy could not be created" error={create.error} /> : null}
          </div>
          <SheetFooter className="mt-auto flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create policy"}
            </Button>
          </SheetFooter>
        </form>
        <ConfirmDialog
          open={confirming !== null}
          onOpenChange={(next) => !next && setConfirming(null)}
          title="Enforce a live quota"
          description={`Live requests from ${project.name} over this limit are refused with 429 from the next request. Use observe mode to measure first.`}
          confirmLabel="Create and enforce"
          busy={create.isPending}
          onConfirm={() => {
            if (confirming) create.mutate(confirming);
            setConfirming(null);
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
