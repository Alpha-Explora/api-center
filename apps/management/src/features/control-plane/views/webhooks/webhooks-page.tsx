"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontalIcon, PlusIcon, WebhookIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { EmptyState } from "@/components/patterns/empty-state";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ErrorPanel, Notice } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { projectHref } from "@/lib/app-navigation";
import { formatDateTime, formatRelative } from "@/lib/format";
import { controlPlane } from "../../data/control-plane-repository";
import { eventDestinations } from "../../data/event-destinations";
import { environmentWriteReason } from "../../model/access";
import type { Application } from "../../model/control-plane";
import { PAYMENT_EVENT_TYPES, TRANSPORT_LABELS, destinationEndpoint, sortDestinations, type EventDestination } from "../../model/event-destinations";
import { eventDestinationsKey, useEventDestinations, usePaymentsEnabled } from "../../view-models/event-destinations";
import { RequireEnvironment, useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";
import { CreateDestinationSheet } from "./create-destination-sheet";
import { WebhookSecretDialog, type IssuedSigningSecret } from "./webhook-secret-dialog";

export function WebhooksPage() {
  return (
    <RequireEnvironment>
      <Webhooks />
    </RequireEnvironment>
  );
}

function Webhooks() {
  const { organizationId, project, kind, canWrite } = useProjectEnvironment();
  const client = useQueryClient();
  const scope = { organizationId, projectId: project.id, kind };
  const destinations = useEventDestinations();
  const applications = useQuery({
    queryKey: cpKeys.applications(organizationId, project.id, kind),
    queryFn: () => controlPlane.applications(organizationId, project.id, kind),
    retry: false,
  });
  const paymentsEnabled = usePaymentsEnabled();
  const [creating, setCreating] = useState(false);
  const [issued, setIssued] = useState<IssuedSigningSecret | null>(null);
  const [rotating, setRotating] = useState<EventDestination | null>(null);
  const [disabling, setDisabling] = useState<EventDestination | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: eventDestinationsKey(organizationId, project.id, kind) });

  const appNames = new Map((applications.data ?? []).map((application) => [application.id, application.name]));
  const nameOf = (destination: EventDestination | null) =>
    destination ? (appNames.get(destination.recipientApplicationId) ?? destination.recipientApplicationId) : "";

  const rotate = useMutation({
    mutationFn: (destination: EventDestination) => eventDestinations.rotateSecret(scope, destination.id),
    onSuccess: (result, destination) => {
      setRotating(null);
      setIssued({
        signingSecret: result.signingSecret,
        applicationName: nameOf(destination),
        previousSecretExpiresAt: result.previousSecretExpiresAt,
        rotated: true,
      });
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const disable = useMutation({
    mutationFn: (destination: EventDestination) => eventDestinations.disable(scope, destination.id),
    onSuccess: (_, destination) => {
      setDisabling(null);
      toast.success(`Disabled ${nameOf(destination)}'s destination`);
      void refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = sortDestinations(destinations.data ?? []);
  const hasApplications = (applications.data ?? []).some((application) => application.status === "active");

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Payment events delivered to your applications as signed HTTPS requests."
        actions={
          <GuardedButton
            allowed={canWrite}
            reason={environmentWriteReason(kind)}
            disabled={!paymentsEnabled || !hasApplications}
            onClick={() => setCreating(true)}
          >
            <PlusIcon data-icon="inline-start" /> Add webhook
          </GuardedButton>
        }
      />

      {!paymentsEnabled ? (
        <Notice
          tone="warning"
          title={`Payments is not enabled in ${kind}`}
          action={
            <Link href={projectHref(project.id, kind, "/capabilities")} className="text-xs font-medium text-foreground hover:underline">
              Go to Capabilities
            </Link>
          }
        >
          Destinations deliver payment events, so they can only be added once payments is enabled in this environment.
        </Notice>
      ) : null}

      <Notice title="How delivery works">
        <ul className="list-disc space-y-0.5 pl-4">
          <li>
            A destination receives every payment event for its application; there is no per-event filter. Today that is{" "}
            {PAYMENT_EVENT_TYPES.map((type) => (
              <code key={type} className="font-mono text-xs text-foreground">
                {type}
              </code>
            ))}
            .
          </li>
          <li>Each application can have one active destination. Disable it to replace it.</li>
          <li>Deliveries are signed with Standard Webhooks headers. Rotating a secret keeps the old one signing for 24 hours.</li>
        </ul>
      </Notice>

      <Panel title="Destinations" flush>
        {destinations.error ? (
          <div className="p-4">
            <ErrorPanel title="Destinations could not be loaded" error={destinations.error} />
          </div>
        ) : destinations.isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<WebhookIcon />}
            title="No webhooks yet"
            description={
              !hasApplications
                ? "Create an application first; each webhook delivers to one application."
                : paymentsEnabled
                  ? "Add a webhook to receive payment events for an application."
                  : "Enable payments in this environment, then add a webhook."
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Application</TableHead>
                <TableHead className="hidden sm:table-cell">Endpoint</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Secret rotated</TableHead>
                <TableHead className="hidden lg:table-cell">Created</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((destination) => (
                <DestinationRow
                  key={destination.id}
                  destination={destination}
                  application={(applications.data ?? []).find((application) => application.id === destination.recipientApplicationId)}
                  canWrite={canWrite}
                  onRotate={() => setRotating(destination)}
                  onDisable={() => setDisabling(destination)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <CreateDestinationSheet
        open={creating}
        onOpenChange={setCreating}
        applications={applications.data ?? []}
        destinations={destinations.data ?? []}
        onWebhookCreated={(destination) => setIssued({ signingSecret: destination.signingSecret, applicationName: nameOf(destination), rotated: false })}
      />
      <WebhookSecretDialog issued={issued} onClose={() => setIssued(null)} />
      <ConfirmDialog
        open={rotating !== null}
        onOpenChange={(next) => !next && setRotating(null)}
        title={`Rotate the signing secret for ${nameOf(rotating)}`}
        description="A new secret signs every delivery from now on. The old secret also keeps signing for 24 hours, so deploy the new one before then. The new secret is shown once."
        confirmLabel="Rotate secret"
        busy={rotate.isPending}
        onConfirm={() => rotating && rotate.mutate(rotating)}
      />
      <ConfirmDialog
        open={disabling !== null}
        onOpenChange={(next) => !next && setDisabling(null)}
        title={`Disable ${nameOf(disabling)}'s ${disabling ? TRANSPORT_LABELS[disabling.transport].toLowerCase() : "destination"}`}
        description="Payment events stop being delivered to it. A disabled destination cannot be turned back on; add a new one to resume deliveries."
        confirmLabel="Disable destination"
        destructive
        busy={disable.isPending}
        onConfirm={() => disabling && disable.mutate(disabling)}
      />
    </>
  );
}

function DestinationRow({
  destination,
  application,
  canWrite,
  onRotate,
  onDisable,
}: {
  destination: EventDestination;
  application: Application | undefined;
  canWrite: boolean;
  onRotate: () => void;
  onDisable: () => void;
}) {
  const { project, kind } = useProjectEnvironment();
  const endpoint = destinationEndpoint(destination);
  const canRotate = destination.transport === "webhook" && destination.status !== "disabled" && destination.status !== "failed";
  const canDisable = destination.status !== "disabled";

  return (
    <TableRow className={destination.status === "disabled" ? "text-muted-foreground" : undefined}>
      <TableCell>
        {application ? (
          <Link
            href={`${projectHref(project.id, kind, `/applications/${encodeURIComponent(application.id)}`)}?tab=webhook`}
            className="font-medium hover:underline"
          >
            {application.name}
          </Link>
        ) : (
          <span className="font-mono text-xs">{destination.recipientApplicationId}</span>
        )}
        <span className="block text-xs text-muted-foreground sm:hidden">{TRANSPORT_LABELS[destination.transport]}</span>
      </TableCell>
      <TableCell className="hidden max-w-xs sm:table-cell">
        <span className="block truncate font-mono text-xs" title={endpoint}>
          {endpoint}
        </span>
        <span className="text-xs text-muted-foreground">{TRANSPORT_LABELS[destination.transport]}</span>
      </TableCell>
      <TableCell className="whitespace-normal">
        <StatusBadge status={destination.status} />
        {destination.status === "failed" && destination.lastError ? (
          <p className="mt-1 max-w-xs text-xs break-words text-danger">{destination.lastError}</p>
        ) : null}
      </TableCell>
      <TableCell className="hidden text-muted-foreground md:table-cell" title={formatDateTime(destination.secretRotatedAt)}>
        {destination.transport === "webhook" ? (destination.secretRotatedAt ? formatRelative(destination.secretRotatedAt) : "Never") : "—"}
      </TableCell>
      <TableCell className="hidden text-muted-foreground lg:table-cell" title={formatDateTime(destination.createdAt)}>
        {formatRelative(destination.createdAt)}
      </TableCell>
      <TableCell className="text-right">
        {canWrite && (canRotate || canDisable) ? (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Actions for ${application?.name ?? destination.id}`} />}>
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              {canRotate ? <DropdownMenuItem onClick={onRotate}>Rotate secret</DropdownMenuItem> : null}
              {canDisable ? (
                <DropdownMenuItem variant="destructive" onClick={onDisable}>
                  Disable
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
