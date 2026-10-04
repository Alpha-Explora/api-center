"use client";

import { useMemo, useState } from "react";
import type { DetailedOperation, PropertyField } from "@/lib/contracts";
import { ScalarApiReference } from "@/components/scalar-api-reference";

// ─── Property Row ──────────────────────────────────────────────
function PropertyRow({ prop }: { prop: PropertyField }) {
  const [expanded, setExpanded] = useState(false);
  const childCount = prop.children?.length ?? 0;
  return (
    <div className="param-row">
      <div className="param-meta">
        <code className="param-name-code">{prop.name}</code>
        <span className="tag tag-type">{prop.type}</span>
        <span className={`tag ${prop.required ? "tag-required" : "tag-optional"}`}>
          {prop.required ? "Required" : "Optional"}
        </span>
      </div>
      {prop.description && <p className="param-desc">{prop.description}</p>}
      {childCount > 0 && (
        <div>
          <button type="button" className="nested-toggle" onClick={() => setExpanded(!expanded)}>
            {expanded ? `− Hide ${childCount} properties` : `+ Show ${childCount} properties`}
          </button>
          {expanded && (
            <div className="nested-children">
              {prop.children!.map((c) => <PropertyRow key={c.name} prop={c} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Top Nav ───────────────────────────────────────────────────
function TopNav({ onScalar }: { onScalar: () => void }) {
  return (
    <nav className="docs-topnav">
      <div className="topnav-brand">
        <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="6" fill="#3B82F6" />
          <path d="M10 22L16 10L22 22H19.5L16 15L12.5 22H10Z" fill="white" />
        </svg>
        <span>APICenter</span>
        <span className="topnav-brand-sep">/</span>
        <span className="topnav-brand-section">REST API</span>
      </div>
      <div className="topnav-right">
        <button type="button" className="topnav-ask-ai" onClick={onScalar}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          Try Interactive Sandbox
        </button>
      </div>
    </nav>
  );
}

// ─── Method badge helpers ──────────────────────────────────────
const METHOD_LABEL: Record<string, string> = {
  DELETE: "DEL", GET: "GET", POST: "POST", PATCH: "PATCH", PUT: "PUT",
};

function MethodBadge({ method, lg }: { method: string; lg?: boolean }) {
  const cls = lg ? "mbadge-lg" : "mbadge";
  const colorCls = `mbadge-${method.toLowerCase()}`;
  return <span className={`${cls} ${colorCls}`}>{METHOD_LABEL[method] ?? method}</span>;
}

// ─── Main component ────────────────────────────────────────────
export function ApiDocLayout({ operations }: { operations: DetailedOperation[] }) {
  const defaultOp = operations.find((op) => op.requiresIdempotency) || operations[0];
  const [view, setView] = useState<"overview" | "endpoint" | "scalar">("overview");
  const [selectedId, setSelectedId] = useState(defaultOp?.operationId ?? "");
  const [tab, setTab] = useState<"TypeScript" | "Next.js" | "cURL">("TypeScript");
  const [copied, setCopied] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map: Record<string, DetailedOperation[]> = {};
    for (const op of operations) {
      const tag = op.tag || "General";
      if (!map[tag]) map[tag] = [];
      map[tag].push(op);
    }
    return map;
  }, [operations]);

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    if (defaultOp?.tag) init[defaultOp.tag] = true;
    return init;
  });

  const activeOp = useMemo(
    () => operations.find((op) => op.operationId === selectedId) || operations[0],
    [operations, selectedId]
  );

  const selectOp = (op: DetailedOperation) => {
    setSelectedId(op.operationId);
    setView("endpoint");
    if (op.tag && !openGroups[op.tag]) {
      setOpenGroups((prev) => ({ ...prev, [op.tag]: true }));
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!activeOp) return null;

  // Code snippets
  const fullUrl = `https://api-center.itsandbox.site${activeOp.path}`;
  const reqBody = activeOp.sampleRequest ? JSON.stringify(activeOp.sampleRequest, null, 2) : null;

  const codeSnippets: Record<string, string> = {
    TypeScript: `import { ApiCenterClient } from "@apicenter/sdk";

const client = new ApiCenterClient({
  baseUrl: "https://api-center.itsandbox.site",
  clientId: "YOUR_TRIBE_ID",
  clientSecret: "YOUR_TRIBE_SECRET",
});

const response = await client.${activeOp.operationId}(${reqBody ?? ""});
console.log(response);`,
    "Next.js": `const response = await fetch("${fullUrl}", {
  method: "${activeOp.method}",
  headers: {
    "Authorization": "Bearer YOUR_ACCESS_TOKEN",
    "Content-Type": "application/json"${activeOp.requiresIdempotency ? `,\n    "Idempotency-Key": "unique-key-${activeOp.operationId}"` : ""}
  }${reqBody ? `,\n  body: JSON.stringify(${reqBody})` : ""}
});

const data = await response.json();
console.log(data);`,
    cURL: `curl -X ${activeOp.method} "${fullUrl}" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
  -H "Content-Type: application/json"${activeOp.requiresIdempotency ? ` \\\n  -H "Idempotency-Key: unique-key-${activeOp.operationId}"` : ""}${reqBody ? ` \\\n  -d '${JSON.stringify(activeOp.sampleRequest)}'` : ""}`,
  };

  const code = codeSnippets[tab];
  const responseJson = JSON.stringify(activeOp.sampleResponse, null, 2);

  // Sidebar
  const Sidebar = (
    <aside className="api-sidebar">
      <button type="button" className="sidebar-back" onClick={() => setView("overview")}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        APICenter REST API
      </button>

      <div className="sidebar-section">
        {(["overview", "scalar"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={`sidebar-item ${view === v ? "active" : ""}`}
            onClick={() => setView(v)}
          >
            {v === "overview" ? "Overview" : "Interactive Sandbox"}
          </button>
        ))}
        <div className="sidebar-item" style={{ cursor: "default" }}>Errors & Quotas</div>
      </div>

      <div className="sidebar-groups">
        {Object.entries(grouped).map(([groupName, items]) => {
          const isOpen = Boolean(openGroups[groupName]);
          return (
            <div key={groupName} className="sidebar-group">
              <button
                type="button"
                className="sidebar-group-btn"
                onClick={() => setOpenGroups((p) => ({ ...p, [groupName]: !p[groupName] }))}
              >
                <span>{groupName}</span>
                <svg
                  className={`sidebar-group-chevron ${isOpen ? "open" : ""}`}
                  width="10" height="10" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>

              {isOpen && (
                <div className="sidebar-endpoints">
                  {items.map((op) => {
                    const isActive = view === "endpoint" && op.operationId === activeOp.operationId;
                    return (
                      <button
                        key={op.operationId}
                        type="button"
                        className={`sidebar-ep-btn ${isActive ? "active" : ""}`}
                        onClick={() => selectOp(op)}
                      >
                        <MethodBadge method={op.method} />
                        <span className="sidebar-ep-name">{op.summary}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );

  // Code panel (right column)
  const CodePanel = (
    <aside className="api-panel">
      {view === "endpoint" ? (
        <>
          {/* Code snippet box */}
          <div className="panel-box">
            <div className="code-tabs-bar">
              <div className="code-tabs">
                {(["TypeScript", "Next.js", "cURL"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`code-tab ${tab === t ? "active" : ""}`}
                    onClick={() => setTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <button type="button" className="code-copy-btn" onClick={() => handleCopy(code, "code")}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {copied === "code" ? "Copied!" : "Copy"}
              </button>
            </div>

            <div className="code-url-bar">
              <span className="code-url-lang">{tab === "cURL" ? "CURL" : tab === "Next.js" ? "JS" : "TS"}</span>
              <span className="code-url-path">https://api-center.itsandbox.site{activeOp.path}</span>
            </div>

            <pre className="code-pre"><code>{code}</code></pre>
          </div>

          {/* Response box */}
          <div className="panel-box">
            <div className="resp-header">
              <span className="resp-title">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                Response
              </span>
              <button type="button" className="code-copy-btn" onClick={() => handleCopy(responseJson, "resp")}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                {copied === "resp" ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="resp-pre"><code>{responseJson}</code></pre>
          </div>
        </>
      ) : (
        <div className="toc-panel">
          <div className="toc-label">On this page</div>
          {["API basics", "Authentication", "Accessing tribe resources", "Idempotency & Retries", "Rate limits", "Endpoints"].map((h) => (
            <a key={h} href={`#${h.toLowerCase().replace(/[^a-z]+/g, "-")}`} className="toc-item">{h}</a>
          ))}
        </div>
      )}

      {/* Footer links */}
      <div className="panel-links" style={{ marginTop: "8px" }}>
        <button type="button" className="panel-link panel-link-scalar" onClick={() => setView("scalar")}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          Interactive Sandbox
        </button>
        <a className="panel-link" href="/api/openapi.json" target="_blank" rel="noreferrer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          OpenAPI Specification
        </a>
        <a className="panel-link" href="/guides/sdk-usage">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          Install APICenter SDK
        </a>
      </div>
    </aside>
  );

  return (
    <>
      <TopNav onScalar={() => setView("scalar")} />

      {view === "scalar" ? (
        <div style={{ width: "100%", height: "calc(100vh - 56px)" }}>
          <ScalarApiReference specUrl="/api/openapi.json" />
        </div>
      ) : (
        <div className="api-shell">
          {Sidebar}

          {view === "overview" ? (
            <>
              {/* OVERVIEW: center */}
              <main className="api-content">
                <div className="breadcrumb">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span>APIs &amp; SDKs</span>
                  <span className="breadcrumb-sep">/</span>
                  <span className="breadcrumb-current">APICenter REST API</span>
                </div>

                <h1 className="content-title">Using the REST API</h1>

                <p className="overview-lead">
                  Interact programmatically with your APICenter account using the SDK or direct HTTP requests. You can execute checkouts at{" "}
                  <code className="icode">/api/v1/payments/checkouts</code>, manage consumer-scoped customer vaults, dispatch SMS/Email notifications, generate OTP passcodes, resolve IP geolocations, and manage service registry.
                </p>
                <p className="overview-sublead">
                  The API supports any programming language or framework that can send HTTP requests.
                </p>

                <div className="callout">
                  <strong>Test interactively →</strong> All REST endpoints can be tested live in the{" "}
                  <button
                    type="button"
                    onClick={() => setView("scalar")}
                    style={{ color: "#60a5fa", textDecoration: "underline", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}
                  >
                    Interactive Sandbox
                  </button>.
                </div>

                <section id="api-basics" className="doc-section">
                  <h2 className="section-title">API basics</h2>
                  <p className="param-desc">
                    The API is exposed as HTTP/1.1 and HTTP/2 over SSL. All endpoints live under{" "}
                    <code className="icode">https://api-center.itsandbox.site</code> and follow REST architecture with JSON request and response bodies.
                  </p>
                </section>

                <section id="authentication" className="doc-section">
                  <h2 className="section-title">Authentication</h2>
                  <p className="param-desc" style={{ marginBottom: "12px" }}>
                    APICenter Bearer Tokens are required to authenticate. Include the token in the <code className="icode">Authorization</code> header:
                  </p>
                  <pre className="codeblock"><code>Authorization: Bearer &lt;TOKEN&gt;</code></pre>
                  <p className="param-desc" style={{ marginTop: "12px" }}>
                    Create tokens using <code className="icode">POST /api/v1/auth/token</code> with your registered tribe credentials (<code className="icode">clientId</code> + <code className="icode">clientSecret</code>).
                  </p>
                </section>

                <section id="accessing-tribe-resources" className="doc-section">
                  <h2 className="section-title">Accessing tribe resources</h2>
                  <p className="param-desc" style={{ marginBottom: "12px" }}>
                    By default, resources belong to the authenticated tribe. To scope resources across environments, pass the environment as a query parameter:
                  </p>
                  <pre className="codeblock"><code>https://api-center.itsandbox.site/api/v1/payments/checkouts?environment=live</code></pre>
                </section>

                <section id="idempotency-retries" className="doc-section">
                  <h2 className="section-title">Idempotency &amp; Retries</h2>
                  <p className="param-desc" style={{ marginBottom: "12px" }}>
                    Payment mutations require an <code className="icode">Idempotency-Key</code> header. Completed responses replay for seven days; keep the same key when retrying an uncertain provider outcome:
                  </p>
                  <pre className="codeblock"><code>Idempotency-Key: &lt;UUID&gt;</code></pre>
                </section>

                <section id="rate-limits" className="doc-section">
                  <h2 className="section-title">Rate limits</h2>
                  <p className="param-desc">
                    Rate limits are communicated via response headers: <code className="icode">X-RateLimit-Limit</code>,{" "}
                    <code className="icode">X-RateLimit-Remaining</code>, and <code className="icode">X-RateLimit-Reset</code>.
                    Standard quota is 20 mutation requests and 100 read requests per minute per tribe.
                  </p>
                </section>

                <section id="endpoints" className="doc-section">
                  <h2 className="section-title">Endpoints</h2>
                  <p className="param-desc" style={{ marginBottom: "16px" }}>
                    Browse all available REST API endpoints grouped by category. Click to view full documentation.
                  </p>
                  <div className="category-grid">
                    {Object.entries(grouped).map(([name, items]) => (
                      <button
                        key={name}
                        type="button"
                        className="category-card"
                        onClick={() => { const first = items[0]; if (first) selectOp(first); }}
                      >
                        <span className="category-name">{name}</span>
                        <span className="category-count">{items.length} endpoints</span>
                      </button>
                    ))}
                  </div>
                </section>
              </main>

              {/* OVERVIEW: right TOC panel */}
              {CodePanel}
            </>
          ) : (
            <>
              {/* ENDPOINT DETAIL: center */}
              <main className="api-content">
                <div className="breadcrumb">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span>APIs &amp; SDKs</span>
                  <span className="breadcrumb-sep">/</span>
                  <span>APICenter REST API</span>
                  <span className="breadcrumb-sep">/</span>
                  <span className="breadcrumb-current">{activeOp.summary}</span>
                </div>

                <h1 className="content-title">{activeOp.summary}</h1>

                <div className="ep-url-row">
                  <MethodBadge method={activeOp.method} lg />
                  <code className="ep-url">https://api-center.itsandbox.site{activeOp.path}</code>
                </div>

                <p className="content-desc">{activeOp.description}</p>

                {/* Authentication */}
                <section className="doc-section">
                  <h2 className="section-title">Authentication</h2>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                    <span className="auth-name">Authorization</span>
                    <span className="tag tag-type">bearerToken</span>
                  </div>
                  <p className="param-desc">Default authentication mechanism using APICenter machine-to-machine Bearer JWT.</p>
                </section>

                {/* Path params */}
                {activeOp.pathParameters.length > 0 && (
                  <section className="doc-section">
                    <h2 className="section-title">Path parameters</h2>
                    {activeOp.pathParameters.map((p) => (
                      <div key={p.name} className="param-row">
                        <div className="param-meta">
                          <code className="param-name-code">{p.name}</code>
                          <span className="tag tag-type">{p.type}</span>
                          <span className="tag tag-required">Required</span>
                        </div>
                        <p className="param-desc">{p.description || `The unique ${p.name} identifier.`}</p>
                      </div>
                    ))}
                  </section>
                )}

                {/* Query params */}
                {activeOp.queryParameters.length > 0 && (
                  <section className="doc-section">
                    <h2 className="section-title">Query parameters</h2>
                    {activeOp.queryParameters.map((q) => (
                      <div key={q.name} className="param-row">
                        <div className="param-meta">
                          <code className="param-name-code">{q.name}</code>
                          <span className="tag tag-type">{q.type}</span>
                          <span className={`tag ${q.required ? "tag-required" : "tag-optional"}`}>
                            {q.required ? "Required" : "Optional"}
                          </span>

                        </div>
                        <p className="param-desc">{q.description || `Filter request by ${q.name}.`}</p>
                      </div>
                    ))}
                  </section>
                )}

                {/* Idempotency header */}
                {activeOp.requiresIdempotency && (
                  <section className="doc-section">
                    <h2 className="section-title">Headers</h2>
                    <div className="param-row">
                      <div className="param-meta">
                        <code className="param-name-code">Idempotency-Key</code>
                        <span className="tag tag-type">string</span>
                        <span className="tag tag-required">Required</span>
                      </div>
                      <p className="param-desc">Unique key for this payment mutation. Reuse it with the same request body when retrying.</p>
                    </div>
                  </section>
                )}

                {/* Request body */}
                {activeOp.requestProperties.length > 0 && (
                  <section className="doc-section">
                    <h2 className="section-title">Request Body</h2>
                    {activeOp.requestProperties.map((prop) => (
                      <PropertyRow key={prop.name} prop={prop} />
                    ))}
                  </section>
                )}

                {/* Response */}
                <section className="doc-section">
                  <h2 className="section-title">Response</h2>
                  <div className="response-header">
                    <span className="status-badge status-200">200</span>
                    <span className="status-label">Success</span>
                  </div>
                  {activeOp.responseProperties.length > 0 ? (
                    activeOp.responseProperties.map((prop) => (
                      <PropertyRow key={prop.name} prop={prop} />
                    ))
                  ) : (
                    <>
                      <div className="param-row">
                        <div className="param-meta">
                          <code className="param-name-code">success</code>
                          <span className="tag tag-type">boolean</span>
                          <span className="tag tag-required">Required</span>
                        </div>
                        <p className="param-desc">Indicates if the gateway request completed successfully.</p>
                      </div>
                      <div className="param-row">
                        <div className="param-meta">
                          <code className="param-name-code">data</code>
                          <span className="tag tag-type">object</span>
                          <span className="tag tag-optional">Optional</span>
                        </div>
                        <p className="param-desc">Canonical resource object returned by APICenter shared service.</p>
                      </div>
                    </>
                  )}
                </section>

                {/* Errors */}
                <section className="doc-section">
                  <h2 className="section-title">Errors</h2>
                  <div className="errors-table">
                    {activeOp.errorResponses.map((err) => (
                      <div key={err.code} className="error-row">
                        <span className="error-code">{err.code}</span>
                        <span className="error-desc">{err.description}</span>
                      </div>
                    ))}
                  </div>
                </section>
              </main>

              {/* ENDPOINT: right code panel */}
              {CodePanel}
            </>
          )}
        </div>
      )}
    </>
  );
}
