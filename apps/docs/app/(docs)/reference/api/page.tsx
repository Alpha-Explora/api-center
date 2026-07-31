import { DocsPage, DocsTitle, DocsDescription, DocsBody } from "fumadocs-ui/page";
import { getDetailedOperations } from "@/lib/contracts";

export const metadata = {
  title: "APICenter REST API Reference",
  description: "Interactive API reference for all APICenter REST endpoints — payments, messaging, OTP, identity, and registry.",
};

export default function ApiOverviewPage() {
  const operations = getDetailedOperations();
  const grouped: Record<string, typeof operations> = {};
  for (const op of operations) {
    const tag = op.tag || "General";
    if (!grouped[tag]) grouped[tag] = [];
    grouped[tag].push(op);
  }

  const METHOD_COLORS: Record<string, string> = {
    GET: "#10b981", POST: "#3b82f6", DELETE: "#ef4444", PATCH: "#f59e0b", PUT: "#f59e0b",
  };

  return (
    <DocsPage
      toc={[
        { title: "API basics", url: "#api-basics", depth: 2 },
        { title: "Authentication", url: "#authentication", depth: 2 },
        { title: "Idempotency", url: "#idempotency", depth: 2 },
        { title: "Rate limits", url: "#rate-limits", depth: 2 },
        { title: "Endpoints", url: "#endpoints", depth: 2 },
      ]}
      breadcrumb={{ enabled: false }}
      footer={{ enabled: false }}
    >
      <DocsTitle>APICenter REST API</DocsTitle>
      <DocsDescription>
        Interact programmatically with your APICenter account via direct HTTP requests or the TypeScript SDK.
        Covers payments, SMS/Email, OTP, geolocation, authentication, and service registry.
      </DocsDescription>

      <DocsBody>
        <section id="api-basics" className="fd-section">
          <h2 className="fd-section-title">API basics</h2>
          <p className="fd-param-desc">
            All endpoints live under{" "}
            <code className="fd-inline-code">https://api-center.itsandbox.site</code>{" "}
            and follow REST conventions with JSON request/response bodies over HTTPS.
          </p>
        </section>

        <section id="authentication" className="fd-section">
          <h2 className="fd-section-title">Authentication</h2>
          <p className="fd-param-desc" style={{ marginBottom: "10px" }}>
            Include a Bearer Token in the <code className="fd-inline-code">Authorization</code> header. Obtain tokens via{" "}
            <code className="fd-inline-code">POST /api/v1/auth/token</code> with your tribe credentials.
          </p>
          <pre className="fd-codeblock">
            <code>Authorization: Bearer &lt;TOKEN&gt;</code>
          </pre>
        </section>

        <section id="idempotency" className="fd-section">
          <h2 className="fd-section-title">Idempotency &amp; Retries</h2>
          <p className="fd-param-desc" style={{ marginBottom: "10px" }}>
            All state-changing operations require an <code className="fd-inline-code">Idempotency-Key</code> header to prevent duplicate execution within a 24-hour window.
          </p>
          <pre className="fd-codeblock">
            <code>Idempotency-Key: &lt;UUID&gt;</code>
          </pre>
        </section>

        <section id="rate-limits" className="fd-section">
          <h2 className="fd-section-title">Rate limits</h2>
          <p className="fd-param-desc">
            Rate limits are signalled via{" "}
            <code className="fd-inline-code">X-RateLimit-Limit</code>,{" "}
            <code className="fd-inline-code">X-RateLimit-Remaining</code>, and{" "}
            <code className="fd-inline-code">X-RateLimit-Reset</code> headers.
            Standard quota: 20 mutations and 100 reads per minute per tribe.
          </p>
        </section>

        <section id="endpoints" className="fd-section">
          <h2 className="fd-section-title">Endpoints</h2>
          <p className="fd-param-desc" style={{ marginBottom: "16px" }}>
            All endpoints grouped by domain. Click to view full documentation with code examples.
          </p>

          {Object.entries(grouped).map(([tag, ops]) => (
            <div key={tag} className="fd-endpoint-group">
              <h3 className="fd-group-name">{tag}</h3>
              <div className="fd-endpoint-list">
                {ops.map((op) => {
                  const color = METHOD_COLORS[op.method] ?? "#6b7280";
                  const label = op.method === "DELETE" ? "DEL" : op.method;
                  return (
                    <a key={op.operationId} href={`/reference/api/${op.operationId}`} className="fd-endpoint-row">
                      <span style={{
                        fontFamily: "monospace", fontSize: "10px", fontWeight: 800,
                        color, background: `${color}1a`, border: `1px solid ${color}40`,
                        padding: "2px 6px", borderRadius: "3px", minWidth: "32px", textAlign: "center",
                        flexShrink: 0,
                      }}>{label}</span>
                      <code className="fd-endpoint-path">{op.path}</code>
                      <span className="fd-endpoint-summary">{op.summary}</span>
                    </a>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      </DocsBody>
    </DocsPage>
  );
}