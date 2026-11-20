import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import { baseOptions } from "@/lib/layout-options";
import { getFumadocsPageTree } from "@/lib/source";

/** Guides and reference: a sidebar of sections, search and the theme switch in the top bar. */
export default function DocsGroupLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <DocsLayout {...baseOptions} tree={getFumadocsPageTree()} nav={{ ...baseOptions.nav, mode: "top" }} sidebar={{ defaultOpenLevel: 0, collapsible: true }}>
      {children}
    </DocsLayout>
  );
}
