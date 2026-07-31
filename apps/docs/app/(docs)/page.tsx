import { DocsPage, DocsTitle, DocsDescription, DocsBody } from "fumadocs-ui/page";

export const metadata = {
  title: "APICenter Developer Documentation",
  description: "Build on top of APICenter — payment processing, messaging, identity, geo, and service registry.",
};

export default function HomePage() {
  return (
    <DocsPage
      toc={[
        { title: "What is APICenter?", url: "#what-is-apicenter", depth: 2 },
        { title: "REST API Reference", url: "#rest-api", depth: 2 },
        { title: "AsyncAPI Events", url: "#events", depth: 2 },
        { title: "Guides", url: "#guides", depth: 2 },
      ]}
      footer={{ enabled: false }}
      breadcrumb={{ enabled: false }}
    >
      <DocsTitle>APICenter Developer Documentation</DocsTitle>
      <DocsDescription>
        Provider-neutral gateway for payments, messaging, OTP, identity, geolocation, and service registry.
        Build once, switch providers without touching your application code.
      </DocsDescription>

      <DocsBody>
        <section id="what-is-apicenter" className="fd-section">
          <h2 className="fd-section-title">What is APICenter?</h2>
          <p className="fd-param-desc">
            APICenter is a provider-neutral shared services gateway that abstracts payment providers (PayMongo), messaging providers (Semaphore, MailerSend), OTP verification, IP geolocation, and authentication into a single unified API surface.
            Your application integrates once and can swap underlying providers without code changes.
          </p>
        </section>

        <section id="rest-api" className="fd-section">
          <h2 className="fd-section-title">REST API Reference</h2>
          <p className="fd-param-desc" style={{ marginBottom: "14px" }}>
            Full REST API documentation generated from the OpenAPI contract. Each endpoint includes path/query parameters, request body, response schema, code examples, and error codes.
          </p>
          <div className="fd-card-grid">
            <a href="/reference/api" className="fd-card">
              <span className="fd-card-title">REST API Overview</span>
              <span className="fd-card-desc">Authentication, rate limits, idempotency, and all endpoint groups</span>
            </a>
            <a href="/reference/api/sandbox" className="fd-card">
              <span className="fd-card-title">Interactive Sandbox</span>
              <span className="fd-card-desc">Test endpoints live in the browser using the Scalar sandbox</span>
            </a>
          </div>
        </section>

        <section id="events" className="fd-section">
          <h2 className="fd-section-title">AsyncAPI Events</h2>
          <p className="fd-param-desc" style={{ marginBottom: "14px" }}>
            Payment lifecycle events delivered to your Cloud Run endpoint via Google Pub/Sub with OIDC authentication.
          </p>
          <div className="fd-card-grid">
            <a href="/reference/events" className="fd-card">
              <span className="fd-card-title">Event Reference</span>
              <span className="fd-card-desc">All normalized payment events — schemas, payloads, and delivery guarantees</span>
            </a>
          </div>
        </section>

        <section id="guides" className="fd-section">
          <h2 className="fd-section-title">Guides</h2>
          <p className="fd-param-desc" style={{ marginBottom: "14px" }}>
            Step-by-step guides for common integrations and migrations.
          </p>
          <div className="fd-card-grid">
            <a href="/guides/getting-started" className="fd-card">
              <span className="fd-card-title">Getting Started</span>
              <span className="fd-card-desc">Set up your tribe credentials and make your first API call</span>
            </a>
            <a href="/guides/authentication" className="fd-card">
              <span className="fd-card-title">Authentication</span>
              <span className="fd-card-desc">Bearer token issuance and rotation</span>
            </a>
            <a href="/guides/payments/checkouts" className="fd-card">
              <span className="fd-card-title">Checkouts</span>
              <span className="fd-card-desc">Create and manage payment checkout sessions</span>
            </a>
            <a href="/guides/migration/from-direct-paymongo" className="fd-card">
              <span className="fd-card-title">Migration Guide</span>
              <span className="fd-card-desc">Move from direct PayMongo integration to APICenter</span>
            </a>
          </div>
        </section>
      </DocsBody>
    </DocsPage>
  );
}