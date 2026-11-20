import { DocsPage, DocsTitle, DocsDescription, DocsBody } from "fumadocs-ui/page";
import { EventReference } from "@/components/event-reference";
import { getContractVersion, getEvents } from "@/lib/contracts";

export const metadata = { title: "AsyncAPI Event Reference", description: "Payment lifecycle events delivered to your backend as signed HTTPS webhooks." };

export default function EventReferencePage() {
  const events = getEvents();
  const versions = getContractVersion();
  return (
    <DocsPage tableOfContent={{ style: "clerk" }}
      toc={[]}
      breadcrumb={{ enabled: false }}
      footer={{ enabled: false }}
    >
      <DocsTitle>Event Reference</DocsTitle>
      <DocsDescription>
        AsyncAPI {versions.asyncapi} — payment lifecycle events delivered to your application's webhook as signed HTTPS requests (webhook-id, webhook-timestamp, webhook-signature), retried with backoff and dead-lettered after the attempt limit.
      </DocsDescription>
      <DocsBody>
        <EventReference events={events} />
      </DocsBody>
    </DocsPage>
  );
}