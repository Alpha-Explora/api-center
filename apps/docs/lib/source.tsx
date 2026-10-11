import type * as PageTree from "fumadocs-core/page-tree";
import { getDetailedOperations } from "./contracts";
import { getPublishedGuides } from "./guides";

const METHOD_COLORS: Record<string, { color: string; bg: string; border: string }> = {
  GET:    { color: "#10b981", bg: "rgba(16,185,129,0.15)",  border: "rgba(16,185,129,0.3)" },
  POST:   { color: "#3b82f6", bg: "rgba(59,130,246,0.15)",  border: "rgba(59,130,246,0.3)" },
  DELETE: { color: "#ef4444", bg: "rgba(239,68,68,0.15)",   border: "rgba(239,68,68,0.3)"  },
  PATCH:  { color: "#f59e0b", bg: "rgba(245,158,11,0.15)",  border: "rgba(245,158,11,0.3)" },
  PUT:    { color: "#f59e0b", bg: "rgba(245,158,11,0.15)",  border: "rgba(245,158,11,0.3)" },
};

function MethodBadge({ method }: { method: string }) {
  const c = METHOD_COLORS[method] ?? { color: "#6b7280", bg: "rgba(107,114,128,0.15)", border: "rgba(107,114,128,0.3)" };
  const label = method === "DELETE" ? "DEL" : method;
  return (
    <span
      style={{
        fontFamily: "var(--font-mono, monospace)",
        fontSize: "9px",
        fontWeight: 800,
        color: c.color,
        background: c.bg,
        border: `1px solid ${c.border}`,
        padding: "1px 5px",
        borderRadius: "3px",
        letterSpacing: "0.04em",
        flexShrink: 0,
        minWidth: "30px",
        textAlign: "center",
        display: "inline-block",
        marginRight: "6px",
      }}
    >
      {label}
    </span>
  );
}

export function getFumadocsPageTree(): PageTree.Root {
  const operations = getDetailedOperations();
  const grouped: Record<string, typeof operations> = {};
  for (const op of operations) {
    const tag = op.tag || "General";
    if (!grouped[tag]) grouped[tag] = [];
    grouped[tag].push(op);
  }

  const categoryFolders: PageTree.Node[] = Object.entries(grouped).map(([tag, ops]): PageTree.Node => ({
    type: "folder",
    name: tag,
    defaultOpen: false,
    children: ops.map((op): PageTree.Node => ({
      type: "page",
      name: op.summary,
      icon: <MethodBadge method={op.method} />,
      url: `/reference/api/${op.operationId}`,
    })),
  }));

  const guideChildren: PageTree.Node[] = [];
  let section = "";
  for (const guide of getPublishedGuides()) {
    if (guide.section !== section) {
      section = guide.section;
      guideChildren.push({ type: "separator", name: section });
    }
    guideChildren.push({ type: "page", name: guide.title, url: guide.url });
  }

  return {
    name: "APICenter Docs",
    children: [
      { type: "page", name: "Overview", url: "/reference/api" },
      { type: "page", name: "Interactive Sandbox", url: "/reference/api/sandbox" },
      { type: "separator", name: "API Categories" },
      ...categoryFolders,
      { type: "separator", name: "Guides & Events" },
      {
        type: "folder",
        name: "AsyncAPI Events",
        defaultOpen: false,
        children: [
          { type: "page", name: "Event Reference", url: "/reference/events" },
        ],
      },
      {
        type: "folder",
        name: "Guides & Tutorials",
        defaultOpen: false,
        children: guideChildren,
      },
    ],
  };
}
