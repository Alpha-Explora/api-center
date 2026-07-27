import { EventReference } from "@/components/event-reference";
import { getContractVersion, getEvents } from "@/lib/contracts";

export const metadata = { title: "Event Reference" };

export default function EventReferencePage() {
  const events = getEvents();
  const versions = getContractVersion();
  return <><div className="page-heading"><span className="eyebrow">AsyncAPI {versions.asyncapi}</span><h1>Event Reference</h1><p>Normalized payment lifecycle events delivered to the registered Cloud Run endpoint through Google Pub/Sub with OIDC authentication and dead-letter handling.</p></div><EventReference events={events} /></>;
}