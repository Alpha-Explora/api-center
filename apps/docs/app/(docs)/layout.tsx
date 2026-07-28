import Link from "next/link";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "APICenter Docs", template: "%s | APICenter Docs" },
  description: "Provider-neutral payments API and event contracts for APICenter consumers.",
};

const primary = [
  ["Getting Started", "/guides/getting-started"],
  ["Authentication", "/guides/authentication"],
  ["Idempotency and Retries", "/guides/idempotency"],
] as const;
const payments = [
  ["Overview", "/guides/payments/overview"],
  ["Current architecture", "/guides/payments/architecture"],
] as const;
const events = [["Pub/Sub Delivery", "/guides/events/pubsub-delivery"]] as const;

export default function DocsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="docs-shell">
      <header className="docs-header">
        <Link className="brand" href="/" aria-label="APICenter documentation home"><span className="brand-mark">AP</span><span>APICenter Docs</span></Link>
        <div className="header-meta"><span>Public contracts v1</span><Link className="header-link" href="/reference/api">API reference <span aria-hidden="true">↗</span></Link></div>
      </header>
      <div className="docs-body">
        <aside className="sidebar" aria-label="Documentation navigation">
          <div className="sidebar-label">Start</div>
          {primary.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}
          <div className="sidebar-label">Payments</div>
          {payments.map(([label, href]) => <Link className="nested" key={href} href={href}>{label}</Link>)}
          <div className="sidebar-label">Events</div>
          {events.map(([label, href]) => <Link className="nested" key={href} href={href}>{label}</Link>)}
          <div className="sidebar-label">Resources</div>
          <Link href="/guides/migration/from-direct-paymongo">Migration from Direct PayMongo</Link>
          <Link href="/guides/consumer-runbook">Consumer Runbook</Link>
          <Link href="/reference/api">API Reference</Link>
          <Link href="/reference/events">Event Reference</Link>
        </aside>
        <main className="docs-main"><div className="content-width">{children}<footer className="footer">APICenter publishes the contract artifacts with the SDK release. Provider credentials and operator provisioning stay out of this public site.</footer></div></main>
      </div>
    </div>
  );
}