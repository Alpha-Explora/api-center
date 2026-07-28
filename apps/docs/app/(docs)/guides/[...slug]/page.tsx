import { notFound } from "next/navigation";
import { GuidePage } from "@/components/guide-page";
import { guideSlugs, readGuide } from "@/lib/guides";

const titles: Record<string, { eyebrow: string; title: string; description: string }> = {
  "getting-started": { eyebrow: "Start here", title: "Getting Started", description: "Register a consumer, make your first authenticated request, and establish the return URL and event delivery boundaries." },
  authentication: { eyebrow: "Security", title: "Authentication", description: "Use an APICenter consumer key with a registered service identity. Keep platform and provider credentials server-side." },
  idempotency: { eyebrow: "Reliability", title: "Idempotency and Retries", description: "Retry provider-impacting writes without creating duplicate resources or charging twice." },
  "payments/overview": { eyebrow: "Payments", title: "Payments Overview", description: "Choose the payment resource and lifecycle operation that matches your integration." },
  "payments/architecture": { eyebrow: "Payments", title: "Current Architecture", description: "See which system owns provider state, which data AlphaCI projects, and how Pub/Sub delivery is recovered." },
  "events/pubsub-delivery": { eyebrow: "Events", title: "Pub/Sub Delivery", description: "Receive canonical payment events with OIDC-authenticated push delivery, dead letters, and replay discipline." },
  "migration/from-direct-paymongo": { eyebrow: "Migration", title: "From Direct PayMongo", description: "Move the provider boundary into APICenter while preserving your application’s domain identifiers and workflows." },
  "consumer-runbook": { eyebrow: "Operations", title: "Consumer Runbook", description: "Operate a provider-neutral payment integration with idempotency, Pub/Sub delivery, and rollback-safe cutover." },
};

export function generateStaticParams() {
  return guideSlugs.map((slug) => ({ slug: [...slug] }));
}

export const dynamicParams = false;

export default async function GuideRoute({ params }: { params: Promise<{ slug: string[] }> }) {
  const resolved = await params;
  const key = resolved.slug.join("/");
  const heading = titles[key];
  if (!heading) notFound();
  return <><div className="page-heading"><span className="eyebrow">{heading.eyebrow}</span><h1>{heading.title}</h1><p>{heading.description}</p></div><GuidePage blocks={readGuide(resolved.slug)} /></>;
}