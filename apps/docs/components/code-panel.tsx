"use client";

import { useState } from "react";
import type { DetailedOperation } from "@/lib/contracts";

type Tab = "TypeScript" | "Next.js" | "cURL";

const LANG_LABELS: Record<Tab, string> = {
  TypeScript: "TS",
  "Next.js": "JS",
  cURL: "CURL",
};

function buildSnippet(op: DetailedOperation, tab: Tab): string {
  const fullUrl = `https://api-center.itsandbox.site${op.path}`;
  const reqBody = op.sampleRequest ? JSON.stringify(op.sampleRequest, null, 2) : null;
  const idempKey = op.requiresIdempotency
    ? `,\n    "Idempotency-Key": "unique-key-${op.operationId}"`
    : "";

  if (tab === "TypeScript") {
    return `import { ApiCenterClient } from "@apicenter/sdk";

const client = new ApiCenterClient({
  baseUrl: "https://api-center.itsandbox.site",
  clientId: "YOUR_TRIBE_ID",
  clientSecret: "YOUR_TRIBE_SECRET",
});

const response = await client.${op.operationId}(${reqBody ?? ""});
console.log(response);`;
  }

  if (tab === "Next.js") {
    return `const response = await fetch("${fullUrl}", {
  method: "${op.method}",
  headers: {
    "Authorization": "Bearer YOUR_ACCESS_TOKEN",
    "Content-Type": "application/json"${idempKey}
  }${reqBody ? `,\n  body: JSON.stringify(${reqBody})` : ""}
});

const data = await response.json();
console.log(data);`;
  }

  let curl = `curl -X ${op.method} "${fullUrl}" \\
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \\
  -H "Content-Type: application/json"`;
  if (op.requiresIdempotency) {
    curl += ` \\\n  -H "Idempotency-Key: unique-key-${op.operationId}"`;
  }
  if (reqBody) {
    curl += ` \\\n  -d '${JSON.stringify(op.sampleRequest)}'`;
  }
  return curl;
}

export function CodePanel({ operation }: { operation: DetailedOperation }) {
  const [tab, setTab] = useState<Tab>("TypeScript");
  const [copied, setCopied] = useState<string | null>(null);

  const code = buildSnippet(operation, tab);
  const responseJson = JSON.stringify(operation.sampleResponse, null, 2);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="fd-code-panel">
      {/* Code snippet box */}
      <div className="fd-panel-box">
        {/* Tab bar */}
        <div className="fd-panel-tabs-bar">
          <div className="fd-panel-tabs">
            {(["TypeScript", "Next.js", "cURL"] as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                data-active={tab === t}
                className="fd-panel-tab"
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="fd-panel-copy"
            onClick={() => copy(code, "code")}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {copied === "code" ? "Copied!" : "Copy"}
          </button>
        </div>

        {/* URL bar */}
        <div className="fd-panel-url-bar">
          <span className="fd-panel-lang">{LANG_LABELS[tab]}</span>
          <span className="fd-panel-url">https://api-center.itsandbox.site{operation.path}</span>
        </div>

        {/* Code */}
        <pre className="fd-panel-pre fd-panel-pre--code">
          <code>{code}</code>
        </pre>
      </div>

      {/* Response box */}
      <div className="fd-panel-box">
        <div className="fd-panel-resp-header">
          <span className="fd-panel-resp-title">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            Response
          </span>
          <button
            type="button"
            className="fd-panel-copy"
            onClick={() => copy(responseJson, "resp")}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {copied === "resp" ? "Copied!" : "Copy"}
          </button>
        </div>
        <pre className="fd-panel-pre fd-panel-pre--resp">
          <code>{responseJson}</code>
        </pre>
      </div>

      {/* Action links */}
      <div className="fd-panel-links">
        <button
          type="button"
          className="fd-action-btn"
          onClick={() => copy(code, "markdown")}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
            <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
          </svg>
          <span>{copied === "markdown" ? "Copied Markdown!" : "Copy as Markdown"}</span>
        </button>

        <a className="fd-action-btn" href="/guides/sdk-usage">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          <span>Install APICenter SDK</span>
        </a>

        <a className="fd-action-btn" href="/api/openapi.json" target="_blank" rel="noreferrer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
          <span>OpenAPI Specification</span>
        </a>

        <a className="fd-action-btn" href="/reference/api/sandbox">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
          <span>Scalar Interactive Sandbox</span>
        </a>
      </div>
    </div>
  );
}
