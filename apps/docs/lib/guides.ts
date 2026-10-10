import { docs } from "../.source";
import registry from "../content/guides.json";

function canonicalPage(slug: string) {
  const data = docs.docs.find((page) => page._file.path.replace(/\\/g, "/") === slug + ".mdx");
  return data ? { data, url: "/guides/" + slug } : undefined;
}

export function getPublishedGuides() {
  return registry.map((entry) => {
    const page = canonicalPage(entry.slug);
    if (!page) throw new Error("Registered guide is missing: " + entry.slug);
    return { ...entry, title: page.data.title, url: page.url };
  });
}

export const guideSlugs = registry.flatMap((entry) => [entry.slug, ...(entry.aliases ?? [])]).map((slug) => slug.split("/"));

export function getGuide(slug: string[]) {
  const key = slug.join("/");
  const entry = registry.find((item) => item.slug === key || item.aliases?.includes(key));
  return entry ? canonicalPage(entry.slug) : undefined;
}
