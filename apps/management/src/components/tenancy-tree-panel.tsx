"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import {
  createProject,
  createTribe,
  listServices,
  listTribes,
  type TenancyWriteConfirmation,
} from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import type { ServiceStatus } from "@/lib/schemas";
import { buildTenancyTree, type TenancyTreeTribe } from "@/lib/tenancy-tree";
import { StatusBadge } from "@/components/status-badge";
import { ActionFailedState, EmptyDataState } from "@/components/query-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const LIVE_CONFIRMATION_PHRASE = "APPLY LIVE CHANGE";

export function TenancyTreePanel() {
  const tribesQuery = useQuery({
    queryKey: queryKeys.tenancyTribes,
    queryFn: listTribes,
  });
  const servicesQuery = useQuery({
    queryKey: queryKeys.services,
    queryFn: listServices,
  });
  const tree = useMemo(
    () => buildTenancyTree(tribesQuery.data ?? [], servicesQuery.data ?? []),
    [tribesQuery.data, servicesQuery.data],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tribes and projects</CardTitle>
        <CardDescription>
          Every tribe service lives in exactly one project. Credentials are
          issued per service; plans and quota budgets attach to the project;
          the tribe holds people, approvals, and an optional quota ceiling.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {tribesQuery.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : tribesQuery.isError ? (
          <ActionFailedState
            title="Could not load tribes"
            description="The tenancy directory is served by the protected API Center tenancy API."
          />
        ) : (
          <>
            {tree.unplaced.length ? (
              <Alert variant="destructive">
                <AlertTitle>Services without a project</AlertTitle>
                <AlertDescription>
                  {tree.unplaced.map((service) => service.serviceId).join(", ")}{" "}
                  cannot get tokens until they are registered in an active
                  project.
                </AlertDescription>
              </Alert>
            ) : null}
            {tree.tribes.length ? (
              <ul className="flex flex-col gap-3" aria-label="Tenancy tree">
                {tree.tribes.map((tribe) => (
                  <TribeNode key={tribe.tribeId} tribe={tribe} />
                ))}
              </ul>
            ) : (
              <EmptyDataState
                title="No tribes yet"
                description="Create a tribe, then add a project before registering its services."
              />
            )}
            <CreateTribeForm />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TribeNode({ tribe }: { tribe: TenancyTreeTribe }) {
  return (
    <li className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">{tribe.name}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {tribe.tribeId} - {tribe.projects.length} project
            {tribe.projects.length === 1 ? "" : "s"} - {tribe.serviceCount} service
            {tribe.serviceCount === 1 ? "" : "s"}
          </div>
        </div>
        <TenancyStatus status={tribe.status} />
      </div>
      <ul className="mt-3 flex flex-col gap-2 border-l pl-3">
        {tribe.projects.map((project) => (
          <li key={project.projectId} className="rounded-md bg-muted/20 p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{project.name}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {project.projectId}
                  {project.costCenter ? ` - cost center ${project.costCenter}` : ""}
                </div>
              </div>
              <TenancyStatus status={project.status} />
            </div>
            {project.registryServices.length ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {project.registryServices.map((service) => (
                  <li key={service.serviceId}>
                    <Link
                      className="rounded-md border bg-background px-2 py-1 font-mono text-xs hover:bg-muted"
                      href={`/tribes/${encodeURIComponent(service.serviceId)}?section=summary`}
                    >
                      {service.serviceId}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-2 text-xs text-muted-foreground">
                No services registered in this project yet.
              </div>
            )}
          </li>
        ))}
      </ul>
      {tribe.status === "active" ? <CreateProjectForm tribeId={tribe.tribeId} /> : null}
    </li>
  );
}

function TenancyStatus({ status }: { status: string }) {
  if (status === "active") return <StatusBadge status={status as ServiceStatus} />;
  return <Badge variant="secondary">{status}</Badge>;
}

function CreateTribeForm() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tribeId, setTribeId] = useState("");
  const [name, setName] = useState("");
  const confirmation = useLiveConfirmation();
  const mutation = useMutation({
    mutationFn: () =>
      createTribe({ tribeId, name }, confirmation.value),
    onSuccess: async () => {
      setTribeId("");
      setName("");
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.tenancyTribes });
    },
  });

  if (!open) {
    return (
      <div>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          <PlusIcon data-icon="inline-start" />
          New tribe
        </Button>
      </div>
    );
  }

  return (
    <form
      aria-label="Create tribe"
      className="grid gap-3 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="tenancy-tribe-id">Tribe ID</FieldLabel>
          <Input
            id="tenancy-tribe-id"
            value={tribeId}
            onChange={(event) => setTribeId(event.target.value)}
            placeholder="logistics"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="tenancy-tribe-name">Name</FieldLabel>
          <Input
            id="tenancy-tribe-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Logistics"
          />
        </Field>
      </div>
      <LiveConfirmationFields idPrefix="tenancy-tribe" state={confirmation} />
      <MutationMessage error={mutation.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={!tribeId.trim() || !name.trim() || mutation.isPending}>
          Create tribe
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CreateProjectForm({ tribeId }: { tribeId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [costCenter, setCostCenter] = useState("");
  const confirmation = useLiveConfirmation();
  const mutation = useMutation({
    mutationFn: () =>
      createProject(
        tribeId,
        { projectId, name, costCenter: costCenter.trim() || undefined },
        confirmation.value,
      ),
    onSuccess: async () => {
      setProjectId("");
      setName("");
      setCostCenter("");
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: queryKeys.tenancyTribes });
    },
  });

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-2"
        onClick={() => setOpen(true)}
      >
        <PlusIcon data-icon="inline-start" />
        New project in {tribeId}
      </Button>
    );
  }

  return (
    <form
      aria-label={`Create project in ${tribeId}`}
      className="mt-3 grid gap-3 rounded-md border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      <div className="grid gap-3 md:grid-cols-3">
        <Field>
          <FieldLabel htmlFor={`tenancy-project-id-${tribeId}`}>Project ID</FieldLabel>
          <Input
            id={`tenancy-project-id-${tribeId}`}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            placeholder={`${tribeId}-orders`}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`tenancy-project-name-${tribeId}`}>Name</FieldLabel>
          <Input
            id={`tenancy-project-name-${tribeId}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`tenancy-project-cost-${tribeId}`}>Cost center</FieldLabel>
          <Input
            id={`tenancy-project-cost-${tribeId}`}
            value={costCenter}
            onChange={(event) => setCostCenter(event.target.value)}
            placeholder="Optional"
          />
        </Field>
      </div>
      <LiveConfirmationFields idPrefix={`tenancy-project-${tribeId}`} state={confirmation} />
      <MutationMessage error={mutation.error} />
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={!projectId.trim() || !name.trim() || mutation.isPending}
        >
          Create project
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

type LiveConfirmationState = ReturnType<typeof useLiveConfirmation>;

function useLiveConfirmation() {
  const [typedPhrase, setTypedPhrase] = useState("");
  const [reason, setReason] = useState("");
  const value: TenancyWriteConfirmation | undefined =
    typedPhrase.trim() || reason.trim()
      ? { typedPhrase: typedPhrase.trim(), reason: reason.trim() }
      : undefined;
  return { typedPhrase, setTypedPhrase, reason, setReason, value };
}

function LiveConfirmationFields({
  idPrefix,
  state,
}: {
  idPrefix: string;
  state: LiveConfirmationState;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-reason`}>Reason (live only)</FieldLabel>
        <Input
          id={`${idPrefix}-reason`}
          value={state.reason}
          onChange={(event) => state.setReason(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor={`${idPrefix}-phrase`}>Confirmation (live only)</FieldLabel>
        <Input
          id={`${idPrefix}-phrase`}
          value={state.typedPhrase}
          onChange={(event) => state.setTypedPhrase(event.target.value)}
          placeholder={`Type ${LIVE_CONFIRMATION_PHRASE}`}
        />
      </Field>
    </div>
  );
}

function MutationMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="text-sm text-destructive" role="alert">
      {error instanceof Error ? error.message : "Request failed."}
    </div>
  );
}
