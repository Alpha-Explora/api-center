import { DocsPage, DocsTitle, DocsDescription, DocsBody } from "fumadocs-ui/page";
import { EventReference } from "@/components/event-reference";
import { getContractVersion, getEvents } from "@/lib/contracts";

export const metadata = { title: "AsyncAPI Event Reference", description: "Normalized payment lifecycle events delivered via Google Pub/Sub." };

export default function EventReferencePage() {
  const events = getEvents();
  const versions = getContractVersion();
  return (
    <DocsPage
      toc={[]}
      breadcrumb={{ enabled: false }}
      footer={{ enabled: false }}
    >
      <DocsTitle>Event Reference</DocsTitle>
      <DocsDescription>
        AsyncAPI {versions.asyncapi} — normalized payment lifecycle events delivered to your registered Cloud Run endpoint through Google Pub/Sub with OIDC authentication and dead-letter handling.
      </DocsDescription>
      <DocsBody>
        <EventReference events={events} />
      </DocsBody>
    </DocsPage>
  );
}