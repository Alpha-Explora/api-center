import { DocsPage, DocsTitle, DocsDescription, DocsBody } from "fumadocs-ui/page";
import { getDetailedOperations } from "@/lib/contracts";

export const metadata = {
  title: "APICenter REST API Reference",
  description: "Contract-derived reference for APICenter payment endpoints.",
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
        This reference describes payment operations declared in the public OpenAPI contract.
        Shared services have separate integration guides; their endpoints are not included in this contract.
      </DocsDescription>

      <DocsBody>
        <section id="api-basics" className="fd-section">
          <h2 className="fd-section-title">API basics</h2>
          <p className="fd-param-desc">
            All endpoints live under{" "}
            <code className="fd-inline-code">{operations[0]?.serverUrl}</code>{" "}
            and follow REST conventions with JSON request/response bodies over HTTPS.
          </p>
        </section>

        <section id="authentication" className="fd-section">
          <h2 className="fd-section-title">Authentication</h2>
          <p className="fd-param-desc" style={{ marginBottom: "10px" }}>
            Use your consumer payment API key in the <code className="fd-inline-code">Authorization</code> header.
            See the <a href="/guides/authentication">authentication guide</a> for credential ownership and shared-service tokens.
          </p>
          <pre className="fd-codeblock">
            <code>Authorization: Bearer &lt;PAYMENT_API_KEY&gt;</code>
          </pre>
        </section>

        <section id="idempotency" className="fd-section">
          <h2 className="fd-section-title">Idempotency &amp; Retries</h2>
          <p className="fd-param-desc" style={{ marginBottom: "10px" }}>
            Payment mutations require an <code className="fd-inline-code">Idempotency-Key</code>. Completed responses replay for seven days; for an uncertain provider outcome, keep the same key and reconcile before starting a new payment.
          </p>
          <pre className="fd-codeblock">
            <code>Idempotency-Key: &lt;UUID&gt;</code>
          </pre>
        </section>

        <section id="rate-limits" className="fd-section">
          <h2 className="fd-section-title">Rate limits</h2>
          <p className="fd-param-desc">
            Quotas depend on the configured consumer policy. See the <a href="/guides/payments/limits">rate-limit guide</a>
            for handling throttling; this contract does not declare fixed per-minute quotas.
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
