import { DocsPage, DocsTitle, DocsDescription, DocsBody } from "fumadocs-ui/page";
import { getDetailedOperations } from "@/lib/contracts";
import { MethodBadge } from "@/lib/source";

export const metadata = {
  title: "API reference",
  description: "Every APICenter endpoint your backend calls, from the public OpenAPI contract.",
};

export default function ApiOverviewPage() {
  const operations = getDetailedOperations();
  const grouped: Record<string, typeof operations> = {};
  for (const op of operations) {
    const tag = op.tag || "General";
    if (!grouped[tag]) grouped[tag] = [];
    grouped[tag].push(op);
  }

  return (
    <DocsPage tableOfContent={{ style: "clerk" }}
      toc={[
        { title: "Basics", url: "#api-basics", depth: 2 },
        { title: "Authentication", url: "#authentication", depth: 2 },
        { title: "Idempotency", url: "#idempotency", depth: 2 },
        { title: "Limits", url: "#rate-limits", depth: 2 },
        { title: "Endpoints", url: "#endpoints", depth: 2 },
      ]}
      breadcrumb={{ enabled: false }}
      footer={{ enabled: false }}
    >
      <DocsTitle>API reference</DocsTitle>
      <DocsDescription>Every endpoint your backend calls, from the public OpenAPI contract. The SDK wraps all of them.</DocsDescription>

      <DocsBody>
        <section id="api-basics" className="fd-section">
          <h2 className="fd-section-title">Basics</h2>
          <p className="fd-param-desc">
            Endpoints live under <code className="fd-inline-code">{operations[0]?.serverUrl}</code> and take and return JSON over HTTPS. Errors share one
            shape with a stable <code className="fd-inline-code">code</code>; see <a href="/guides/errors">errors and retries</a>.
          </p>
        </section>

        <section id="authentication" className="fd-section">
          <h2 className="fd-section-title">Authentication</h2>
          <p className="fd-param-desc" style={{ marginBottom: "10px" }}>
            Send your application key as a bearer token. A key belongs to one application in one environment: <code className="fd-inline-code">ak_test_…</code>{" "}
            or <code className="fd-inline-code">ak_live_…</code>. The application may call an action only when it holds a grant for it; otherwise the call
            fails with <code className="fd-inline-code">ACTION_NOT_GRANTED</code>. See <a href="/guides/authentication">authentication and grants</a>.
          </p>
          <pre className="fd-codeblock">
            <code>Authorization: Bearer ak_test_…</code>
          </pre>
        </section>

        <section id="idempotency" className="fd-section">
          <h2 className="fd-section-title">Idempotency</h2>
          <p className="fd-param-desc" style={{ marginBottom: "10px" }}>
            Payment changes, email and SMS sends, and OTP generate and verify take an <code className="fd-inline-code">Idempotency-Key</code>. A retry with the
            same key returns the first response for seven days instead of acting twice. Each endpoint says whether it needs one; the SDK sends it for you.
          </p>
          <pre className="fd-codeblock">
            <code>Idempotency-Key: 6f1c1d1e-0000-4000-8000-000000000001</code>
          </pre>
        </section>

        <section id="rate-limits" className="fd-section">
          <h2 className="fd-section-title">Limits</h2>
          <p className="fd-param-desc">
            Each environment has a daily request allowance from its plan, plus any quota policies its project sets. A request over a limit fails with{" "}
            <code className="fd-inline-code">429</code>: <code className="fd-inline-code">RATE_LIMITED</code> clears after{" "}
            <code className="fd-inline-code">Retry-After</code> seconds, <code className="fd-inline-code">QUOTA_EXCEEDED</code> when the window resets. Payments add
            amount and rate limits of their own; see <a href="/guides/payments/limits">payment limits</a>.
          </p>
        </section>

        <section id="endpoints" className="fd-section">
          <h2 className="fd-section-title">Endpoints</h2>
          <p className="fd-param-desc" style={{ marginBottom: "16px" }}>
            By capability. Each page has its request, responses, errors and examples in the SDK and with curl.
          </p>

          {Object.entries(grouped).map(([tag, ops]) => (
            <div key={tag} className="fd-endpoint-group">
              <h3 className="fd-group-name">{tag}</h3>
              <div className="fd-endpoint-list">
                {ops.map((op) => (
                  <a key={op.operationId} href={`/reference/api/${op.operationId}`} className="fd-endpoint-row">
                    <MethodBadge method={op.method} />
                    <code className="fd-endpoint-path">{op.path}</code>
                    <span className="fd-endpoint-summary">{op.summary}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </section>
      </DocsBody>
    </DocsPage>
  );
}
