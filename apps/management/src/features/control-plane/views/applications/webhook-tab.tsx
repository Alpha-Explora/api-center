"use client";
import Link from "next/link";
import { WebhookIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { IdText } from "@/components/patterns/copy-button";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorPanel } from "@/components/patterns/notices";
import { DescriptionList, Panel } from "@/components/patterns/panel";
import { StatusBadge } from "@/components/patterns/status-badge";
import { projectHref } from "@/lib/app-navigation";
import { formatDateTime, formatRelative } from "@/lib/format";
import type { Application } from "../../model/control-plane";
import { TRANSPORT_LABELS, destinationEndpoint, liveDestinationFor } from "../../model/event-destinations";
import { useEventDestinations } from "../../view-models/event-destinations";
import { useProjectEnvironment } from "../../view-models/project-environment";
import { WebhookDeliveriesPanel } from "../webhooks/webhook-deliveries-panel";

/** The application's payment event destination, if it has one. Changes happen on the Webhooks page. */
export function WebhookTab({ application }: { application: Application }) {
  const { project, kind } = useProjectEnvironment();
  const destinations = useEventDestinations();
  const webhooksHref = projectHref(project.id, kind, "/webhooks");
  const manage = (
    <Link href={webhooksHref} className={buttonVariants({ size: "sm", variant: "outline" })}>
      Open Webhooks
    </Link>
  );

  if (destinations.error) return <ErrorPanel title="The webhook could not be loaded" error={destinations.error} />;
  if (!destinations.data) return <Skeleton className="h-32 w-full" />;

  const destination = liveDestinationFor(application.id, destinations.data);
  const disabledCount = destinations.data.filter((entry) => entry.recipientApplicationId === application.id && entry.status === "disabled").length;

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Webhook"
        description="Where this application receives payment events. Add, rotate and disable destinations on the Webhooks page."
        actions={manage}
      >
        {destination ? (
          <DescriptionList
            items={[
              {
                label: "Status",
                value: (
                  <span className="flex flex-col items-start gap-1">
                    <StatusBadge status={destination.status} />
                    {destination.status === "failed" && destination.lastError ? <span className="text-xs text-danger">{destination.lastError}</span> : null}
                  </span>
                ),
              },
              { label: "Transport", value: TRANSPORT_LABELS[destination.transport] },
              { label: "Endpoint", value: <span className="font-mono text-xs break-all">{destinationEndpoint(destination)}</span> },
              ...(destination.transport === "webhook"
                ? [
                    {
                      label: "Secret rotated",
                      value: destination.secretRotatedAt ? (
                        <span title={formatDateTime(destination.secretRotatedAt)}>{formatRelative(destination.secretRotatedAt)}</span>
                      ) : (
                        "Never"
                      ),
                    },
                  ]
                : []),
              { label: "Created", value: <span title={formatDateTime(destination.createdAt)}>{formatRelative(destination.createdAt)}</span> },
              { label: "ID", value: <IdText value={destination.id} /> },
            ]}
          />
        ) : (
          <EmptyState
            icon={<WebhookIcon />}
            title="No webhook"
            description={`This application receives no payment events.${disabledCount ? ` It has ${disabledCount} disabled destination${disabledCount === 1 ? "" : "s"}.` : ""}`}
            className="py-6"
          />
        )}
      </Panel>
      {destination?.transport === "webhook" ? <WebhookDeliveriesPanel key={destination.id} destination={destination} /> : null}
    </div>
  );
}
