import Link from "next/link";
import { getApiOperations, getContractVersion, getEvents } from "@/lib/contracts";

export default function DocsHomePage() {
  const versions = getContractVersion();
  const operations = getApiOperations();
  const events = getEvents();
  return (
    <div className="hero">
      <span className="eyebrow">Developer platform / payments</span>
      <h1>Build on a payment contract that stays yours.</h1>
      <p>APICenter gives registered services a provider-neutral payments API, durable idempotency, and authenticated lifecycle events. Integrate once; keep PayMongo credentials behind the platform boundary.</p>
      <div className="hero-actions"><Link className="button primary" href="/guides/getting-started">Start integrating <span aria-hidden="true">→</span></Link><Link className="button" href="/reference/api">Explore {operations.length} API operations</Link></div>
      <div className="grid-cards">
        <Link className="card" href="/guides/authentication"><h2>Authentication</h2><p>Use the APICenter consumer key and registered service identity. Provider keys never enter your runtime.</p><code>Authorization: Bearer apic_...</code></Link>
        <Link className="card" href="/guides/idempotency"><h2>Reliable writes</h2><p>Retry safely with the required Idempotency-Key on provider-impacting operations.</p><code>Idempotency-Key: order-123-create</code></Link>
        <Link className="card" href="/reference/events"><h2>Event-authoritative state</h2><p>Subscribe through OIDC-authenticated Pub/Sub delivery and reconcile from the canonical event envelope.</p><code>payment.checkout.paid</code></Link>
      </div>
      <section className="page-heading" style={{ marginTop: 64 }}><span className="eyebrow">Contract snapshot</span><h2 style={{ fontSize: 28, margin: "12px 0 8px" }}>Public artifacts</h2><p>OpenAPI {versions.openapi} and AsyncAPI {versions.asyncapi} are checked in beside the SDK and released together.</p></section>
    </div>
  );
}