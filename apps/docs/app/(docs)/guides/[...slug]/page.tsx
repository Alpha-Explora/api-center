import { notFound } from "next/navigation";
import { DocsPage, DocsTitle, DocsDescription, DocsBody } from "fumadocs-ui/page";
import { GuidePage } from "@/components/guide-page";
import { guideSlugs, readGuide } from "@/lib/guides";

const titles: Record<string, { eyebrow: string; title: string; description: string }> = {
  "getting-started": { eyebrow: "Platform", title: "Getting Started", description: "Overview of APICenter gateway, service routing, and core setup." },
  authentication: { eyebrow: "Security", title: "Authentication & Scopes", description: "Request machine-to-machine JWT tokens, scopes, and JWKS verification." },
  idempotency: { eyebrow: "Reliability", title: "Idempotency & Rate Limits", description: "Idempotency keys, reference IDs, quotas, and retry strategies." },
  "sdk-usage": { eyebrow: "SDK", title: "APICenter SDK", description: "Integrate using official TypeScript and Node.js SDK helper libraries." },
  "payments/overview": { eyebrow: "Financial", title: "Payments Overview", description: "Provider-neutral PayMongo facade and payments engine overview." },
  "payments/checkouts": { eyebrow: "Financial", title: "Checkouts & Payment Links", description: "Create hosted payment checkout sessions and links." },
  "payments/intents": { eyebrow: "Financial", title: "Payment Intents API", description: "Create, retrieve, confirm, and cancel payment intents." },
  "payments/customers": { eyebrow: "Financial", title: "Customers", description: "Create and look up customer records scoped to a consumer service." },
  "payments/subscriptions": { eyebrow: "Financial", title: "Subscriptions & Invoices", description: "Recurring billing resources and invoice lookup." },
  "payments/refunds": { eyebrow: "Financial", title: "Refunds API", description: "Issue idempotent full or partial refunds for settled payments." },
  "messaging-verification/sms": { eyebrow: "Messaging", title: "SMS Shared Service", description: "Dispatch transactional single and bulk SMS notifications." },
  "messaging-verification/email": { eyebrow: "Messaging", title: "Email Shared Service", description: "Send HTML/text transactional email notifications." },
  "messaging-verification/otp": { eyebrow: "Verification", title: "OTP Verification Service", description: "Generate and verify 6-digit One-Time Passwords." },
  "identity-gateway/auth-tokens": { eyebrow: "Identity", title: "Auth & Token Issuance", description: "Issue M2M access tokens and discover public JWKS keys." },
  "identity-gateway/registry-health": { eyebrow: "Registry", title: "Service Registry & Health", description: "Service self-registration catalog and gateway health probes." },
  "platform-utilities/geo": { eyebrow: "Utilities", title: "Geo & IP Location", description: "Lookup IP geolocation, postal code, and region info." },
  "events/pubsub-delivery": { eyebrow: "Events", title: "Pub/Sub Delivery", description: "Google Pub/Sub webhook delivery architecture, DLQs, and replay." },
  "migration/from-direct-paymongo": { eyebrow: "Migration", title: "From Direct PayMongo", description: "Migrate direct provider integrations into APICenter." },
  "consumer-runbook": { eyebrow: "Operations", title: "Consumer Runbook", description: "Operational checklist for consumer platform integrations." },
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

  return (
    <DocsPage full={false}>
      <DocsTitle>{heading.title}</DocsTitle>
      <DocsDescription>{heading.description}</DocsDescription>
      <DocsBody>
        <GuidePage blocks={readGuide(resolved.slug)} />
      </DocsBody>
    </DocsPage>
  );
}
