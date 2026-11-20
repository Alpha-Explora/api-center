import { DocsPage, DocsTitle, DocsDescription, DocsBody } from "fumadocs-ui/page";
import { getDetailedOperations, type PropertyField } from "@/lib/contracts";
import { CodePanel } from "@/components/code-panel";
import { notFound } from "next/navigation";
import legacyReferences from "@/content/legacy-reference.json";
import { MethodBadge as SharedMethodBadge } from "@/lib/source";

export function generateStaticParams() {
  return [...new Set([...getDetailedOperations().map((op) => op.operationId), ...Object.keys(legacyReferences)])].map((operationId) => ({ operationId }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ operationId: string }> }) {
  const { operationId } = await params;
  const op = getDetailedOperations().find((o) => o.operationId === operationId);
  return {
    title: op?.summary ?? operationId,
    description: op?.description,
  };
}

// ─── Method badge ─────────────────────────────────────────────
// The shared badge from the sidebar, a size up for the page header.
function MethodBadge({ method }: { method: string }) {
  return (
    <span className="inline-flex scale-125 origin-left">
      <SharedMethodBadge method={method} />
    </span>
  );
}

// ─── Parameter Tag pill ─────────────────────────────────────────
function Tag({ children, variant = "type" }: { children: React.ReactNode; variant?: "type" | "required" | "optional" }) {
  const cls = variant === "required" ? "fd-tag fd-tag-required" : variant === "optional" ? "fd-tag fd-tag-optional" : "fd-tag fd-tag-type";
  return <span className={cls}>{children}</span>;
}

// ─── Property row ─────────────────────────────────────────────
function PropRow({ prop }: { prop: PropertyField }) {
  return (
    <div className="fd-prop-row">
      <div className="fd-prop-meta">
        <code className="fd-prop-name">{prop.name}</code>
        <Tag variant="type">{prop.type}</Tag>
        <Tag variant={prop.required ? "required" : "optional"}>{prop.required ? "Required" : "Optional"}</Tag>
      </div>
      {prop.description && <p className="fd-param-desc">{prop.description}</p>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────
export default async function EndpointPage({ params }: { params: Promise<{ operationId: string }> }) {
  const { operationId } = await params;
  const op = getDetailedOperations().find((o) => o.operationId === operationId);
  if (!op) {
    const guide = (legacyReferences as Record<string, string>)[operationId];
    if (!guide) notFound();
    return <DocsPage tableOfContent={{ style: "clerk" }}><DocsTitle>Shared-service integration guide</DocsTitle><DocsBody>
      <p>This bookmark points to maintained integration guidance. The downloadable OpenAPI includes supported consumer payment, identity, and shared-service operations.</p>
      <p><a href={"/guides/" + guide}>Read the integration guide</a></p>
    </DocsBody></DocsPage>;
  }

  return (
    <DocsPage
      full={true}
      toc={[]}
      tableOfContent={{ component: <CodeColumn><CodePanel operation={op} /></CodeColumn>, enabled: true }}
      tableOfContentPopover={{ enabled: false }}
      breadcrumb={{
        enabled: true,
        component: (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "12px",
            color: "var(--color-fd-muted-foreground)",
            marginBottom: "8px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
          }}>
            <a href="/reference/api" style={{ color: "var(--color-fd-muted-foreground)", textDecoration: "none" }}>API reference</a>
            <span style={{ opacity: 0.4 }}>/</span>
            <a href={`/reference/api#endpoints`} style={{ color: "var(--color-fd-muted-foreground)", textDecoration: "none" }}>{op.tag || "General"}</a>
            <span style={{ opacity: 0.4 }}>/</span>
            <span style={{ color: "var(--color-fd-foreground)", fontWeight: 500 }}>{op.summary}</span>
          </div>
        ),
      }}
      footer={{ enabled: false }}
    >
      {/* Title row */}
      <div className="fd-ep-header">
        <DocsTitle>{op.summary}</DocsTitle>
        <div className="fd-ep-url-row">
          <MethodBadge method={op.method} />
          <code className="fd-ep-url">{op.serverUrl}{op.path}</code>
        </div>
        <DocsDescription>{op.description}</DocsDescription>
      </div>

      <div className="xl:hidden"><CodePanel operation={op} /></div>
      <DocsBody>
        {/* Authentication */}
        <section className="fd-section">
          <h2 className="fd-section-title">Authentication</h2>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
            <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-fd-foreground)" }}>Authorization</span>
            <Tag variant="type">APICenterApiKey</Tag>
          </div>
          <p className="fd-param-desc">{op.authentication}</p>
        </section>

        {/* Path params */}
        {op.pathParameters.length > 0 && (
          <section className="fd-section">
            <h2 className="fd-section-title">Path parameters</h2>
            {op.pathParameters.map((p) => (
              <div key={p.name} className="fd-prop-row">
                <div className="fd-prop-meta">
                  <code className="fd-prop-name">{p.name}</code>
                  <Tag variant="type">{p.type}</Tag>
                  <Tag variant="required">Required</Tag>
                </div>
                <p className="fd-param-desc">{p.description || `The unique ${p.name} identifier.`}</p>
              </div>
            ))}
          </section>
        )}

        {/* Query params */}
        {op.queryParameters.length > 0 && (
          <section className="fd-section">
            <h2 className="fd-section-title">Query parameters</h2>
            {op.queryParameters.map((q) => (
              <div key={q.name} className="fd-prop-row">
                <div className="fd-prop-meta">
                  <code className="fd-prop-name">{q.name}</code>
                  <Tag variant="type">{q.type}</Tag>
                  <Tag variant={q.required ? "required" : "optional"}>{q.required ? "Required" : "Optional"}</Tag>
                  {q.deprecated && <Tag variant="type">Deprecated</Tag>}
                </div>
                <p className="fd-param-desc">{q.description || `Filter by ${q.name}.`}</p>
              </div>
            ))}
          </section>
        )}

        {op.headerParameters.length > 0 && (
          <section className="fd-section">
            <h2 className="fd-section-title">Headers</h2>
            {op.headerParameters.map((header) => <PropRow key={header.name} prop={header} />)}
          </section>
        )}

        {/* Request body */}
        {op.requestProperties.length > 0 && (
          <section className="fd-section">
            <h2 className="fd-section-title">Request Body</h2>
            {op.requestProperties.map((p) => <PropRow key={p.name} prop={p} />)}
          </section>
        )}

        {op.successResponses.map((response) => (
          <section key={response.code} className="fd-section">
            <h2 className="fd-section-title">Response</h2>
            <div className="fd-status-row">
              <span className="fd-status-badge fd-status-200">{response.code}</span>
              <span className="fd-status-label">{response.description}</span>
            </div>
            {response.properties.map((property) => <PropRow key={property.name} prop={property} />)}
          </section>
        ))}

        {/* Errors */}
        <section className="fd-section">
          <h2 className="fd-section-title">Errors</h2>
          <div className="fd-errors-table">
            {op.errorResponses.map((err) => (
              <div key={err.code} className="fd-error-row">
                <span className="fd-error-code">{err.code}</span>
                <span className="fd-error-desc">{err.description}</span>
              </div>
            ))}
          </div>
        </section>
      </DocsBody>
    </DocsPage>
  );
}

/** The request and response examples, in the column the table of contents uses on other pages: sticky, wider, desktop only. */
function CodeColumn({ children }: { children: React.ReactNode }) {
  return (
    <div
      id="nd-toc"
      className="sticky top-(--fd-docs-row-1) h-[calc(var(--fd-docs-height)-var(--fd-docs-row-1))] w-(--fd-toc-width) overflow-y-auto pt-12 pe-4 pb-4 [grid-area:toc] max-xl:hidden xl:layout:[--fd-toc-width:440px]"
    >
      {children}
    </div>
  );
}
