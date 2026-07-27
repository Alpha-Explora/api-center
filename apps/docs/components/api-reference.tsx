"use client";

import { useMemo, useState } from "react";
import type { ApiOperation } from "@/lib/contracts";

export function ApiReference({ operations }: { operations: ApiOperation[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return operations;
    return operations.filter((operation) =>
      [operation.path, operation.method, operation.operationId, operation.summary]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [operations, query]);

  return (
    <section className="reference-stack" aria-label="HTTP API reference">
      <div className="reference-toolbar">
        <label htmlFor="api-search">Filter operations</label>
        <input id="api-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search paths or operation IDs" />
        <span className="muted">{filtered.length} of {operations.length}</span>
      </div>
      <div className="operation-list">
        {filtered.map((operation) => (
          <article className="operation" key={`${operation.method}-${operation.path}`}>
            <div className="operation-heading">
              <span className={`method method-${operation.method.toLowerCase()}`}>{operation.method}</span>
              <code>{operation.path}</code>
            </div>
            <h3>{operation.summary}</h3>
            <p>{operation.description}</p>
            <div className="operation-meta">
              <span>operationId: <code>{operation.operationId}</code></span>
              {operation.hasRequestBody ? <span>JSON body</span> : null}
              {operation.requiresIdempotency ? <span className="tag">Idempotency-Key</span> : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}