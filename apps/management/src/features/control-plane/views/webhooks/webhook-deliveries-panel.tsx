"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2Icon, Loader2Icon, SendIcon, XCircleIcon } from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/patterns/empty-state";
import { GuardedButton } from "@/components/patterns/guarded-button";
import { ErrorPanel } from "@/components/patterns/notices";
import { Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDateTime, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { webhookDeliveries } from "../../data/webhook-deliveries";
import { environmentWriteReason } from "../../model/access";
import type { EventDestination } from "../../model/event-destinations";
import {
  TEST_EVENT_TYPE,
  TEST_EVENT_WAIT_MS,
  deliveryOutcome,
  deliveryResponse,
  testEventProgress,
  type SentTestEvent,
  type WebhookDelivery,
} from "../../model/webhook-deliveries";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { useWebhookDeliveries, webhookDeliveriesKey } from "../../view-models/webhook-deliveries";

/** A signed webhook's recent delivery attempts, and a button that sends it a test event and follows it. Key it by destination ID. */
export function WebhookDeliveriesPanel({
  destination,
  title = "Deliveries",
  selector,
}: {
  destination: EventDestination;
  title?: string;
  selector?: ReactNode;
}) {
  const { organizationId, project, kind, canWrite } = useProjectEnvironment();
  const client = useQueryClient();
  const scope = { organizationId, projectId: project.id, kind };
  const [sent, setSent] = useState<SentTestEvent | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const deliveries = useWebhookDeliveries(scope, destination.id, sent && !timedOut ? sent.eventId : null);
  const progress = sent ? testEventProgress(sent.eventId, deliveries.data ?? []) : null;
  const settled = progress?.state === "delivered";

  useEffect(() => {
    if (!sent || settled) return;
    const remaining = Date.parse(sent.sentAt) + TEST_EVENT_WAIT_MS - Date.now();
    const timer = window.setTimeout(() => setTimedOut(true), Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [sent, settled]);

  const send = useMutation({
    mutationFn: () => webhookDeliveries.sendTestEvent(scope, destination.id),
    onSuccess: (result) => {
      setTimedOut(false);
      setSent(result);
      void client.invalidateQueries({ queryKey: webhookDeliveriesKey(organizationId, project.id, kind, destination.id) });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const active = destination.status === "active";
  const rows = deliveries.data ?? [];

  return (
    <Panel
      title={title}
      description="Recent attempts to deliver to this webhook, newest first. History is kept for 30 days."
      flush
      actions={
        <>
          {selector}
          <GuardedButton
            size="sm"
            variant="outline"
            allowed={canWrite && active}
            reason={canWrite ? `This webhook is ${destination.status}; only an active webhook can receive a test event.` : environmentWriteReason(kind)}
            disabled={send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <SendIcon data-icon="inline-start" />}
            Send test event
          </GuardedButton>
        </>
      }
    >
      {sent && progress ? <TestEventResult sent={sent} progress={progress} timedOut={timedOut} /> : null}
      {deliveries.error ? (
        <div className="p-4">
          <ErrorPanel title="Delivery history is unavailable" error={deliveries.error} />
        </div>
      ) : deliveries.isLoading ? (
        <div className="flex flex-col gap-2 p-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No deliveries yet"
          description={active ? "Attempts appear here once a payment event or a test event is delivered." : "This webhook has no recorded attempts."}
          className="py-8"
        />
      ) : (
        <DeliveriesTable rows={rows} highlight={sent?.eventId} />
      )}
    </Panel>
  );
}

function TestEventResult({ sent, progress, timedOut }: { sent: SentTestEvent; progress: ReturnType<typeof testEventProgress>; timedOut: boolean }) {
  const event = <code className="font-mono text-xs text-foreground">{sent.eventId}</code>;
  let icon: ReactNode;
  let title: string;
  let detail: ReactNode;
  let tone: "info" | "success" | "danger";
  if (progress.state === "delivered") {
    tone = "success";
    icon = <CheckCircle2Icon className="size-4 text-success" />;
    title = "Test event delivered";
    detail = (
      <>
        Your endpoint answered {deliveryResponse(progress.delivery)} in {progress.delivery.latencyMs} ms (attempt {progress.delivery.attempt}). Event {event}.
      </>
    );
  } else if (progress.state === "failing") {
    tone = "danger";
    icon = <XCircleIcon className="size-4 text-danger" />;
    title = `Attempt ${progress.delivery.attempt} failed: ${deliveryResponse(progress.delivery)}`;
    detail = <>Pub/Sub retries with backoff, so a later attempt may still succeed. Fix the endpoint and watch this table. Event {event}.</>;
  } else if (timedOut) {
    tone = "info";
    icon = <XCircleIcon className="size-4 text-muted-foreground" />;
    title = "No attempt recorded after a minute";
    detail = <>The event was published ({event}) but the webhooks service has not recorded an attempt yet. Refresh later, or check the subscription.</>;
  } else {
    tone = "info";
    icon = <Loader2Icon className="size-4 animate-spin text-muted-foreground" />;
    title = "Test event sent, waiting for the first attempt…";
    detail = (
      <>
        Published {formatRelative(sent.sentAt)} as {event}. It is signed and delivered like a real payment event.
      </>
    );
  }
  return (
    <div
      role="status"
      className={cn(
        "flex gap-3 border-b px-4 py-3 text-[13px]",
        tone === "success" && "bg-success-soft",
        tone === "danger" && "bg-danger-soft",
        tone === "info" && "bg-muted/50",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 break-words text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function DeliveriesTable({ rows, highlight }: { rows: WebhookDelivery[]; highlight?: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="hidden sm:table-cell">Time</TableHead>
          <TableHead>Event</TableHead>
          <TableHead>Result</TableHead>
          <TableHead className="hidden md:table-cell">Response</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Latency</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Attempt</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((delivery, index) => {
          const outcome = deliveryOutcome(delivery);
          return (
            <TableRow
              key={`${delivery.eventId}-${delivery.attempt}-${delivery.attemptedAt}-${index}`}
              className={cn(delivery.eventId === highlight && "bg-muted/40")}
            >
              <TableCell className="hidden text-muted-foreground sm:table-cell" title={formatDateTime(delivery.attemptedAt)}>
                {formatRelative(delivery.attemptedAt)}
              </TableCell>
              <TableCell className="max-w-[11rem] sm:max-w-xs">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-xs">{delivery.eventType ?? "event"}</span>
                  {delivery.eventType === TEST_EVENT_TYPE ? <StatusBadge tone="info">Test</StatusBadge> : null}
                </span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground" title={delivery.eventId}>
                  {delivery.eventId}
                </span>
                <span className="block text-xs text-muted-foreground sm:hidden">{formatRelative(delivery.attemptedAt)}</span>
              </TableCell>
              <TableCell className="whitespace-normal">
                <StatusBadge tone={outcome.tone}>{outcome.label}</StatusBadge>
                <span className="mt-1 block max-w-[9rem] truncate text-xs text-muted-foreground md:hidden" title={deliveryResponse(delivery)}>
                  {deliveryResponse(delivery)}
                </span>
              </TableCell>
              <TableCell className="hidden max-w-xs md:table-cell">
                <span
                  className={cn("block truncate text-xs", delivery.statusCode === null ? "text-muted-foreground" : "font-mono")}
                  title={deliveryResponse(delivery)}
                >
                  {deliveryResponse(delivery)}
                </span>
              </TableCell>
              <TableCell className="hidden text-right text-muted-foreground tabular-nums sm:table-cell">{delivery.latencyMs} ms</TableCell>
              <TableCell className="hidden text-right text-muted-foreground tabular-nums lg:table-cell">{delivery.attempt}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
