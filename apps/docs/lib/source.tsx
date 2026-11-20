import type * as PageTree from "fumadocs-core/page-tree";
import { getDetailedOperations } from "./contracts";
import { getPublishedGuides } from "./guides";

/** HTTP methods by meaning, in the console's status colors: reads are neutral, writes info, deletes danger. */
const METHOD_TONES: Record<string, string> = {
  GET: "text-fd-muted-foreground bg-fd-muted",
  POST: "text-[var(--info)] bg-[var(--info-soft)]",
  PUT: "text-[var(--warning)] bg-[var(--warning-soft)]",
  PATCH: "text-[var(--warning)] bg-[var(--warning-soft)]",
  DELETE: "text-[var(--danger)] bg-[var(--danger-soft)]",
};

export function MethodBadge({ method }: { method: string }) {
  return (
    <span className={`mr-1.5 inline-block min-w-[2.1rem] shrink-0 rounded-[3px] px-1 text-center font-mono text-[9.5px] font-semibold leading-4 ${METHOD_TONES[method] ?? "bg-fd-muted text-fd-muted-foreground"}`}>
      {method === "DELETE" ? "DEL" : method}
    </span>
  );
}

/** A sidebar section heading: small, uppercase and quiet, as in the console. */
function SectionLabel({ children }: { children: string }) {
  return <span className="mt-2 text-[11px] font-medium tracking-[0.06em] text-fd-muted-foreground uppercase">{children}</span>;
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

  // Guides lead, by section, open; the reference follows. Events sit with the integration guides.
  const guideNodes: PageTree.Node[] = [];
  let section = "";
  for (const guide of getPublishedGuides()) {
    if (guide.section !== section) {
      section = guide.section;
      guideNodes.push({ type: "separator", name: <SectionLabel>{section}</SectionLabel> });
    }
    guideNodes.push({ type: "page", name: guide.title, url: guide.url });
    if (guide.slug === "events/webhooks") guideNodes.push({ type: "page", name: "Event reference", url: "/reference/events" });
  }

  return {
    name: "APICenter Docs",
    children: [
      ...guideNodes,
      { type: "separator", name: <SectionLabel>API reference</SectionLabel> },
      { type: "page", name: "Overview", url: "/reference/api" },
      { type: "page", name: "Try it in the browser", url: "/reference/api/sandbox" },
      ...categoryFolders,
    ],
  };
}
