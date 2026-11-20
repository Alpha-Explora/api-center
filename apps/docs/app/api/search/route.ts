import { createSearchAPI } from "fumadocs-core/search/server";
import { getDetailedOperations } from "@/lib/contracts";
import { getPublishedGuides } from "@/lib/guides";

// The docs are a static export, so search runs in the browser on this prebuilt index: every guide by its
// headings and text, and every API operation by its summary, method and path.
export const revalidate = false;

export const { staticGET: GET } = createSearchAPI("advanced", {
  indexes: () => [
    ...getPublishedGuides().map((guide) => ({
      id: guide.url,
      title: guide.title,
      description: guide.description,
      url: guide.url,
      breadcrumbs: ["Guides", guide.section],
      structuredData: guide.data.structuredData,
    })),
    ...getDetailedOperations().map((operation) => ({
      id: `/reference/api/${operation.operationId}`,
      title: operation.summary,
      description: `${operation.method} ${operation.path}`,
      url: `/reference/api/${operation.operationId}`,
      breadcrumbs: ["API reference", operation.tag || "General"],
      structuredData: {
        headings: [],
        contents: [{ heading: undefined, content: [operation.description, `${operation.method} ${operation.path}`].filter(Boolean).join(" ") }],
      },
    })),
  ],
});
