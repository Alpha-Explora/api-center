import type { MDXContent } from "mdx/types";
import defaultComponents from "fumadocs-ui/mdx";

export function GuidePage({ body: Body }: { body: MDXContent }) {
  return <div className="guide-content"><Body components={defaultComponents} /></div>;
}
