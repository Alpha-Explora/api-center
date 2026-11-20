"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GaugeIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { EmptyState } from "@/components/patterns/empty-state";
import { FormRow } from "@/components/patterns/form";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { Panel } from "@/components/patterns/panel";
import { matchesQuery } from "@/lib/app-navigation";
import { cn } from "@/lib/utils";
import { controlPlane } from "../../data/control-plane-repository";
import { quotas } from "../../data/quotas";
import type { EnvironmentKind, ProjectSummary } from "../../model/control-plane";
import { EMPTY_QUOTA_FORM, sharedQuotaFormToBody, type QuotaForm, type QuotaFormErrors, type QuotaPolicy, type SharedQuotaPolicyBody } from "../../model/quotas";
import { PageSkeleton } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";
import { useAccess, useOrganization } from "../../view-models/use-organization";
import { observability } from "../../data/observability";
import { observabilityKeys } from "../../view-models/observability";
import { QuotaMeterBar } from "./quota-meter";
import { QUOTA_LIMITATIONS, QUOTA_RULES, QuotaPolicyFields, QuotaPolicyTable, statusChangeCopy } from "./quota-parts";

const DESCRIPTION = "Shared ceilings: one request budget that several projects draw from together, for test or live.";

export function OrganizationQuotasPage() {
  const { organizationId } = useOrganization();
  const { access, loading } = useAccess(organizationId);

  if (!organizationId) return <EmptyState title="No organization selected" description="Choose an organization from the switcher in the sidebar." />;
  if (loading) return <PageSkeleton />;
  if (!access.canManageQuotas) {
    return (
      <>
        <PageHeader title="Quotas" description={DESCRIPTION} />
        <Notice title="Shared ceilings are managed by organization owners and admins">
          Your organization role is {access.organizationRole ?? "not set"}. A project&apos;s own quota policies are on that project&apos;s Quotas page, where project
          admins can manage them.
        </Notice>
      </>
    );
  }
  return <SharedCeilings organizationId={organizationId} />;
}

function SharedCeilings({ organizationId }: { organizationId: string }) {
  const client = useQueryClient();
  const key = ["cp", organizationId, "quota-policies"];
  const policies = useQuery({ queryKey: key, queryFn: () => quotas.organizationPolicies(organizationId), retry: false });
  const projects = useQuery({ queryKey: cpKeys.projects(organizationId), queryFn: () => controlPlane.listProjects(organizationId), retry: false });
  const [creating, setCreating] = useState(false);
  const [changing, setChanging] = useState<QuotaPolicy | null>(null);
  const setStatus = useMutation({
    mutationFn: (policy: QuotaPolicy) => quotas.setStatus(organizationId, policy.id, policy.status === "active" ? "disabled" : "active"),
    onSuccess: (updated) => {
      toast.success(updated.status === "active" ? "Shared ceiling enabled" : "Shared ceiling disabled");
      setChanging(null);
      // Project quota pages list the shared ceilings that cover them.
      void client.invalidateQueries({ queryKey: ["cp", organizationId] });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const usage = useQuery({
    queryKey: observabilityKeys.sharedQuotaUsage(organizationId),
    queryFn: () => observability.sharedQuotaUsage(organizationId),
    retry: false,
    refetchInterval: 60_000,
  });
  const meters = new Map((usage.data?.meters ?? []).map((meter) => [meter.policyId, meter]));
  const names = new Map((projects.data ?? []).map((project) => [project.id, project.name]));
  const shared = (policies.data ?? []).filter((policy) => policy.scope === "shared");
  const copy = statusChangeCopy(changing);

  return (
    <>
      <PageHeader
        title="Quotas"
        description={DESCRIPTION}
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon data-icon="inline-start" /> New shared ceiling
          </Button>
        }
      />
      <Notice title="How quotas apply">
        {`${QUOTA_RULES} ${QUOTA_LIMITATIONS} A project's own policies are on that project's Quotas page.`}
      </Notice>
      {policies.error ? <ErrorPanel title="Quota policies could not be loaded" error={policies.error} /> : null}
      {usage.error ? <ErrorPanel title="Quota usage could not be loaded" error={usage.error} /> : null}
      {(["test", "live"] as const).map((kind) => {
        const rows = shared.filter((policy) => policy.environmentKind === kind);
        return (
          <Panel key={kind} title={`${kind === "live" ? "Live" : "Test"} shared ceilings`} flush>
            {policies.isLoading ? (
              <div className="flex flex-col gap-2 p-4">
                <Skeleton className="h-8 w-full" />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState icon={<GaugeIcon />} title={`No ${kind} shared ceilings`} description="Each project is limited only by its plan and its own policies." />
            ) : (
              <QuotaPolicyTable
                policies={rows}
                usage={(policy) => (usage.isLoading ? <Skeleton className="h-4 w-32" /> : usage.error ? null : <QuotaMeterBar meter={meters.get(policy.id)} />)}
                extra={{
                  label: "Covers",
                  render: (policy) => {
                    const covered = (policy.coveredProjectIds ?? []).map((id) => names.get(id) ?? id);
                    return (
                      <span className="line-clamp-2 text-muted-foreground" title={covered.join(", ")}>
                        {covered.length} project{covered.length === 1 ? "" : "s"}: {covered.join(", ")}
                      </span>
                    );
                  },
                }}
                actions={(policy) => (
                  <Button size="sm" variant="ghost" onClick={() => setChanging(policy)}>
                    {policy.status === "active" ? "Disable" : "Enable"}
                  </Button>
                )}
              />
            )}
          </Panel>
        );
      })}

      <CreateSharedCeilingSheet
        organizationId={organizationId}
        projects={projects.data ?? []}
        projectsError={projects.error}
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => void client.invalidateQueries({ queryKey: ["cp", organizationId] })}
      />

      <ConfirmDialog
        open={changing !== null}
        onOpenChange={(next) => !next && setChanging(null)}
        title={`${copy.title} shared ceiling in ${changing?.environmentKind ?? ""}`}
        description={`${copy.description} It covers ${changing?.coveredProjectIds?.length ?? 0} project${changing?.coveredProjectIds?.length === 1 ? "" : "s"}.`}
        confirmLabel={copy.confirmLabel}
        destructive={changing?.status !== "active" && changing?.mode === "enforce"}
        busy={setStatus.isPending}
        onConfirm={() => changing && setStatus.mutate(changing)}
      />
    </>
  );
}

function CreateSharedCeilingSheet({
  organizationId,
  projects,
  projectsError,
  open,
  onOpenChange,
  onCreated,
}: {
  organizationId: string;
  projects: ProjectSummary[];
  projectsError: unknown;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState<QuotaForm>(EMPTY_QUOTA_FORM);
  const [kind, setKind] = useState<EnvironmentKind>("test");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [errors, setErrors] = useState<QuotaFormErrors>({});
  const [confirming, setConfirming] = useState<SharedQuotaPolicyBody | null>(null);
  const create = useMutation({
    mutationFn: (body: SharedQuotaPolicyBody) => quotas.createSharedPolicy(organizationId, body),
    onSuccess: (_, body) => {
      toast.success(`Shared ceiling created for ${body.projectIds.length} project${body.projectIds.length === 1 ? "" : "s"} in ${body.environmentKind}`);
      close(false);
      onCreated();
    },
  });
  const visible = projects.filter((project) => matchesQuery(filter, project.name, project.slug));
  const toggle = (id: string, on: boolean) => setProjectIds((current) => (on ? [...current, id] : current.filter((entry) => entry !== id)));

  function close(next: boolean) {
    if (!next) {
      setForm(EMPTY_QUOTA_FORM);
      setKind("test");
      setProjectIds([]);
      setFilter("");
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
          className="flex h-full min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const result = sharedQuotaFormToBody({ ...form, projectIds }, kind);
            setErrors(result.ok ? {} : result.errors);
            if (!result.ok) return;
            // An enforcing live ceiling can refuse live traffic on the next request.
            if (result.body.environmentKind === "live" && result.body.mode !== "observe") setConfirming(result.body);
            else create.mutate(result.body);
          }}
        >
          <SheetHeader>
            <SheetTitle>New shared ceiling</SheetTitle>
            <SheetDescription>One budget the chosen projects draw from together. It cannot be edited later, only disabled.</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium">Environment</span>
              <div role="radiogroup" aria-label="Environment" className="grid grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5">
                {(["test", "live"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={kind === value}
                    onClick={() => setKind(value)}
                    className={cn(
                      "flex h-7 items-center justify-center gap-1.5 rounded-[5px] text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                      kind === value && "bg-card text-foreground shadow-xs dark:bg-input/40",
                      kind === value && value === "live" && "text-live",
                    )}
                  >
                    <span aria-hidden className={cn("size-1.5 rounded-full", value === "live" ? "bg-live" : "bg-muted-foreground/60")} />
                    {value === "live" ? "Live" : "Test"}
                  </button>
                ))}
              </div>
            </div>

            <FormRow label={`Projects (${projectIds.length} chosen)`} htmlFor="shared-projects-filter" error={errors.projectIds}>
              {projectsError ? <ErrorPanel title="Projects could not be loaded" error={projectsError} /> : null}
              {projects.length > 6 ? (
                <Input id="shared-projects-filter" placeholder="Filter projects" value={filter} onChange={(event) => setFilter(event.target.value)} />
              ) : null}
              <div role="group" aria-label="Projects" className="flex max-h-56 flex-col overflow-y-auto rounded-md border">
                {visible.map((project) => (
                  <label key={project.id} className="flex cursor-pointer items-center gap-2.5 border-b px-3 py-2 text-[13px] last:border-b-0 hover:bg-muted/50">
                    <input
                      type="checkbox"
                      className="accent-foreground"
                      checked={projectIds.includes(project.id)}
                      onChange={(event) => toggle(project.id, event.target.checked)}
                    />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    <span className="truncate font-mono text-xs text-muted-foreground">{project.slug}</span>
                  </label>
                ))}
                {visible.length === 0 ? <p className="px-3 py-2 text-[13px] text-muted-foreground">No projects match.</p> : null}
              </div>
            </FormRow>

            <QuotaPolicyFields form={form} onChange={setForm} errors={errors} idPrefix="shared-quota" />
            {create.error ? <ErrorPanel title="The shared ceiling could not be created" error={create.error} /> : null}
          </div>
          <SheetFooter className="mt-auto flex-row justify-end border-t">
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create shared ceiling"}
            </Button>
          </SheetFooter>
        </form>
        <ConfirmDialog
          open={confirming !== null}
          onOpenChange={(next) => !next && setConfirming(null)}
          title="Enforce a live shared ceiling"
          description={`Live requests from the ${confirming?.projectIds.length ?? 0} chosen project${confirming?.projectIds.length === 1 ? "" : "s"} over this limit are refused with 429 from the next request. Use observe mode to measure first.`}
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
