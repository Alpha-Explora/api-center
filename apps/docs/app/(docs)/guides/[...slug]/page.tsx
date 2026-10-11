import { notFound } from "next/navigation";
import { DocsPage, DocsTitle, DocsDescription, DocsBody } from "fumadocs-ui/page";
import { GuidePage } from "@/components/guide-page";
import { getGuide, guideSlugs } from "@/lib/guides";

export function generateStaticParams() {
  return guideSlugs.map((slug) => ({ slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const page = getGuide((await params).slug);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description, alternates: { canonical: page.url } };
}

export default async function GuideRoute({ params }: { params: Promise<{ slug: string[] }> }) {
  const page = getGuide((await params).slug);
  if (!page) notFound();
  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody><GuidePage body={page.data.body} /></DocsBody>
    </DocsPage>
  );
}
