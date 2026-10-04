"use client";

import { useMemo, useState } from "react";
import type { DetailedOperation } from "@/lib/contracts";

interface VercelApiDocProps {
  operations: DetailedOperation[];
}

export function VercelApiDoc({ operations }: VercelApiDocProps) {
  const defaultOp = operations.find((op) => op.requiresIdempotency) || operations[0];
  const [selectedId, setSelectedId] = useState<string>(defaultOp?.operationId ?? "");
  const [activeTab, setActiveTab] = useState<"TypeScript" | "Next.js" | "cURL">("TypeScript");
  const [copied, setCopied] = useState<string | null>(null);

  // Group operations by tag
  const grouped = useMemo(() => {
    const map: Record<string, DetailedOperation[]> = {};
    for (const op of operations) {
      const tag = op.tag || "General";
      if (!map[tag]) map[tag] = [];
      map[tag].push(op);
    }
    return map;
  }, [operations]);

  const activeOp = useMemo(() => {
    return operations.find((op) => op.operationId === selectedId) || operations[0];
  }, [operations, selectedId]);

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  if (!activeOp) return null;

  // Generate dynamic code snippets
  const getCodeSnippet = (lang: "TypeScript" | "Next.js" | "cURL") => {
    const fullUrl = `https://api-center.itsandbox.site${activeOp.path}`;
    const reqBody = activeOp.sampleRequest ? JSON.stringify(activeOp.sampleRequest, null, 2) : null;

    if (lang === "TypeScript") {
      return `import { ApiCenterClient } from "@apicenter/sdk";

const client = new ApiCenterClient({
  baseUrl: "https://api-center.itsandbox.site",
  clientId: "YOUR_TRIBE_ID",
  clientSecret: "YOUR_TRIBE_SECRET",
  environment: "live"
});

const response = await client.${activeOp.operationId}(${reqBody ? reqBody : ""});
console.log(response);`;
    }

    if (lang === "Next.js") {
      return `const response = await fetch("${fullUrl}", {
  method: "${activeOp.method}",
  headers: {
    "Authorization": "Bearer YOUR_ACCESS_TOKEN",
    "Content-Type": "application/json"${activeOp.requiresIdempotency ? ',\n    "Idempotency-Key": "' + activeOp.operationId + '-idem-123"' : ""}
  }${reqBody ? `,\n  body: JSON.stringify(${reqBody})` : ""}
});

const data = await response.json();
console.log(data);`;
    }

    // cURL
    let curl = `curl -X ${activeOp.method} "${fullUrl}" \\\n  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\\n  -H "Content-Type: application/json"`;
    if (activeOp.requiresIdempotency) {
      curl += ` \\\n  -H "Idempotency-Key: ${activeOp.operationId}-idem-123"`;
    }
    if (reqBody) {
      curl += ` \\\n  -d '${JSON.stringify(activeOp.sampleRequest)}'`;
    }
    return curl;
  };

  const codeText = getCodeSnippet(activeTab);
  const responseJson = JSON.stringify(activeOp.sampleResponse, null, 2);

  return (
    <div className="vercel-api-container">
      {/* COLUMN 1: LEFT SIDEBAR NAVIGATION */}
      <aside className="vercel-api-sidebar">
        <div className="sidebar-back-link">
          <span className="back-arrow">‹</span> APICenter REST API
        </div>

        <div className="sidebar-nav-section">
          <div className="sidebar-nav-item">Overview</div>
          <div className="sidebar-nav-item">Errors & Quotas</div>
        </div>

        <div className="sidebar-groups">
          {Object.entries(grouped).map(([groupName, items]) => (
            <div key={groupName} className="sidebar-group-box">
              <div className="sidebar-group-header">
                <span>{groupName}</span>
                <span className="group-arrow">▾</span>
              </div>
              <div className="sidebar-group-items">
                {items.map((op) => {
                  const isSelected = op.operationId === activeOp.operationId;
                  const methodClass = op.method.toLowerCase();
                  const badgeLabel = op.method === "DELETE" ? "DEL" : op.method;

                  return (
                    <button
                      key={op.operationId}
                      className={`sidebar-endpoint-btn ${isSelected ? "selected" : ""}`}
                      onClick={() => setSelectedId(op.operationId)}
                    >
                      <span className={`method-badge method-${methodClass}`}>{badgeLabel}</span>
                      <span className="endpoint-name">{op.summary}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* COLUMN 2: CENTER DOCUMENTATION & PARAMS */}
      <main className="vercel-api-main">
        <div className="breadcrumb-trail">
          <span className="breadcrumb-icon">📖</span> APIs & SDKs / APICenter REST API / <span className="breadcrumb-current">{activeOp.summary}</span>
        </div>

        <h1 className="endpoint-title">{activeOp.summary}</h1>

        <div className="endpoint-url-box">
          <span className={`method-badge-lg method-${activeOp.method.toLowerCase()}`}>
            {activeOp.method}
          </span>
          <code className="endpoint-url">https://api-center.itsandbox.site{activeOp.path}</code>
        </div>

        <p className="endpoint-description">{activeOp.description}</p>

        {/* AUTHENTICATION */}
        <section className="doc-section">
          <h2 className="section-heading">Authentication</h2>
          <div className="auth-row">
            <span className="param-name">Authorization</span>
            <span className="pill pill-type">bearerToken</span>
          </div>
          <p className="param-desc">Default authentication mechanism using APICenter machine-to-machine JWT.</p>
        </section>

        {/* PATH PARAMETERS */}
        {activeOp.pathParameters.length > 0 && (
          <section className="doc-section">
            <h2 className="section-heading">Path parameters</h2>
            {activeOp.pathParameters.map((p) => (
              <div key={p.name} className="param-block">
                <div className="param-header">
                  <code className="param-name">{p.name}</code>
                  <span className="pill pill-type">{p.type}</span>
                  <span className="pill pill-required">Required</span>
                </div>
                <p className="param-desc">{p.description || `The unique ${p.name} identifier.`}</p>
              </div>
            ))}
          </section>
        )}

        {/* QUERY PARAMETERS */}
        {activeOp.queryParameters.length > 0 && (
          <section className="doc-section">
            <h2 className="section-heading">Query parameters</h2>
            {activeOp.queryParameters.map((q) => (
              <div key={q.name} className="param-block">
                <div className="param-header">
                  <code className="param-name">{q.name}</code>
                  <span className="pill pill-type">{q.type}</span>
                  <span className={`pill ${q.required ? "pill-required" : "pill-optional"}`}>
                    {q.required ? "Required" : "Optional"}
                  </span>
                </div>
                <p className="param-desc">{q.description || `Filter request by ${q.name}.`}</p>
              </div>
            ))}
          </section>
        )}

        {/* HEADERS */}
        {activeOp.requiresIdempotency && (
          <section className="doc-section">
            <h2 className="section-heading">Headers</h2>
            <div className="param-block">
              <div className="param-header">
                <code className="param-name">Idempotency-Key</code>
                <span className="pill pill-type">string</span>
                <span className="pill pill-required">Required</span>
              </div>
              <p className="param-desc">Unique key for this payment mutation. Reuse it with the same request body when retrying.</p>
            </div>
          </section>
        )}

        {/* RESPONSE SCHEMA */}
        <section className="doc-section">
          <h2 className="section-heading">Response</h2>
          <div className="response-status-bar">
            <span className="status-badge status-200">200</span>
            <span className="status-label">Success</span>
          </div>

          <div className="param-block" style={{ marginTop: "12px" }}>
            <div className="param-header">
              <code className="param-name">success</code>
              <span className="pill pill-type">boolean</span>
            </div>
            <p className="param-desc">Indicates if the gateway request completed successfully.</p>
          </div>

          <div className="param-block">
            <div className="param-header">
              <code className="param-name">data</code>
              <span className="pill pill-type">object</span>
              <span className="pill pill-optional">Optional</span>
            </div>
            <p className="param-desc">Canonical resource object returned by APICenter shared service.</p>
          </div>
        </section>
      </main>

      {/* COLUMN 3: RIGHT STICKY CODE & RESPONSE PANEL */}
      <aside className="vercel-api-panel">
        {/* TOP BOX: CODE SNIPPET */}
        <div className="panel-box code-box">
          <div className="code-box-header">
            <div className="code-tabs">
              {(["TypeScript", "Next.js", "cURL"] as const).map((tab) => (
                <button
                  key={tab}
                  className={`code-tab-btn ${activeTab === tab ? "active" : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className="code-url-bar">
            <span className="code-lang-icon">TS</span>
            <span className="code-url-text">https://api-center.itsandbox.site{activeOp.path}</span>
            <button
              className="copy-btn"
              onClick={() => handleCopy(codeText, "code")}
              title="Copy code snippet"
            >
              {copied === "code" ? "✓ Copied" : "📋"}
            </button>
          </div>

          <pre className="code-snippet-pre">
            <code>{codeText}</code>
          </pre>
        </div>

        {/* MIDDLE BOX: RESPONSE OUTPUT */}
        <div className="panel-box response-box">
          <div className="response-box-header">
            <span className="response-box-title">
              <span className="title-icon">🗂</span> Response
            </span>
            <button
              className="copy-btn"
              onClick={() => handleCopy(responseJson, "response")}
              title="Copy response JSON"
            >
              {copied === "response" ? "✓ Copied" : "📋"}
            </button>
          </div>

          <pre className="response-json-pre">
            <code>{responseJson}</code>
          </pre>
        </div>

        {/* BOTTOM FOOTER UTILITIES */}
        <div className="panel-footer-actions">
          <button className="footer-action-btn" onClick={() => handleCopy(codeText, "markdown")}>
            <span className="action-icon">📋</span> Copy as Markdown
          </button>
          <a className="footer-action-btn" href="/guides/sdk-usage">
            <span className="action-icon">&gt;_</span> Install APICenter SDK
          </a>
          <a className="footer-action-btn" href="/api/openapi.json" target="_blank">
            <span className="action-icon">📄</span> OpenAPI Specification
          </a>
          <button className="footer-action-btn">
            <span className="action-icon">💬</span> Give feedback
          </button>
          <button className="footer-action-btn highlight-ask-ai">
            <span className="action-icon">✨</span> Ask AI about this page
          </button>
        </div>
      </aside>
    </div>
  );
}
