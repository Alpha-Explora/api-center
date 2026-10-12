import { DocsPage, DocsTitle, DocsDescription, DocsBody } from "fumadocs-ui/page";

export const metadata = {
  title: "APICenter Developer Documentation",
  description: "Register services and use APICenter shared APIs from your backend.",
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
        Register a service in your organization, then use APICenter shared APIs from your backend with the server-side SDK.
      </DocsDescription>

      <DocsBody>
        <section id="what-is-apicenter" className="fd-section">
          <h2 className="fd-section-title">What is APICenter?</h2>
          <p className="fd-param-desc">
            APICenter gives organization teams a governed way to share APIs for payments, email, SMS, OTP, Google sign-in, and geolocation. Management access follows the Organization → Tribe → Project → Service hierarchy. Registered backend services use the SDK or REST API; APICenter applies service authentication, scopes, and routing.
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
              <span className="fd-card-desc">Get organization access, register a service, and make a first request</span>
            </a>
            <a href="/guides/sdk-usage" className="fd-card">
              <span className="fd-card-title">SDK integration</span>
              <span className="fd-card-desc">Install the TypeScript client and configure server credentials</span>
            </a>
            <a href="/guides/management/access-and-tenancy" className="fd-card">
              <span className="fd-card-title">Management access and tenancy</span>
              <span className="fd-card-desc">Understand organization membership and the registry hierarchy</span>
            </a>
            <a href="/guides/management/register-service" className="fd-card">
              <span className="fd-card-title">Register a service</span>
              <span className="fd-card-desc">Create its tribe, project, registry entry, and environment credentials</span>
            </a>
            <a href="/guides/management/google-sign-in" className="fd-card">
              <span className="fd-card-title">Configure Google sign-in</span>
              <span className="fd-card-desc">Set project OAuth redirects and use the GAuth SDK methods</span>
            </a>
            <a href="/guides/payments/overview" className="fd-card">
              <span className="fd-card-title">Shared APIs</span>
              <span className="fd-card-desc">Browse payments, messaging, verification, identity, and geo guides</span>
            </a>
          </div>
        </section>
      </DocsBody>
    </DocsPage>
  );
}
