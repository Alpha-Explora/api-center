import Link from "next/link";
import { ArrowRightIcon, CheckIcon } from "lucide-react";
import { highlight } from "fumadocs-core/highlight";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";
import { CONSOLE_URL } from "@/lib/layout-options";

export const metadata = {
  title: { absolute: "APICenter Docs" },
  description: "Call email, SMS, one-time codes, Google sign-in, geolocation and payments from your backend through one API and one key.",
};

const CAPABILITIES = [
  { name: "Email", href: "/guides/messaging-verification/email", text: "Send transactional email from a verified sender, and read its delivery status." },
  { name: "SMS", href: "/guides/messaging-verification/sms", text: "Send text messages and track delivery, with test sends kept to your own numbers." },
  { name: "One-time codes", href: "/guides/messaging-verification/otp", text: "Generate and verify codes by SMS or email, sent in your project's name." },
  { name: "Google sign-in", href: "/guides/identity-gateway/gauth", text: "Run the OAuth flow for your users without holding Google client secrets." },
  { name: "Geolocation", href: "/guides/platform-utilities/geo", text: "Geocode addresses, reverse-geocode coordinates and check geofences." },
  { name: "Payments", href: "/guides/payments/overview", text: "Checkouts, intents, links, refunds and subscriptions, with signed webhooks." },
];

const STEPS = [
  { title: "Create an application", text: "In the console, enable a capability and grant your application the actions it calls." },
  { title: "Issue a key", text: "Keep the ak_test_… key in your server's secret store; it is shown once." },
  { title: "Make a request", text: "Call APICenter with the server-side SDK, or the REST API directly." },
];

const SNIPPET = `import { ApiCenter } from "@alpha-explora/apicenter-sdk";

const api = new ApiCenter(); // reads APICENTER_API_KEY

await api.email.send({
  to: "person@example.com",
  subject: "Welcome",
  text: "Your account is ready.",
});`;

const CURL = `curl https://api.apicenter.itsandbox.site/api/v1/shared/email/send \
  -H "Authorization: Bearer $APICENTER_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"to":"person@example.com","subject":"Welcome","text":"Your account is ready."}'`;

/** Code highlighted at build time, in the docs' light and dark themes, with a copy button. */
async function Code({ code, lang, title }: { code: string; lang: "ts" | "bash"; title: string }) {
  const rendered = await highlight(code, {
    lang,
    components: { pre: (props) => <Pre {...props} /> },
  });
  return (
    <CodeBlock title={title} className="my-0">
      {rendered}
    </CodeBlock>
  );
}

export default async function HomePage() {
  return (
    <main className="flex flex-1 flex-col">
      {/* Hero: framed by dashed grid lines, centered. */}
      <section className="relative mx-auto w-full max-w-6xl px-4 pt-10 sm:px-6">
        <div className="relative border-x border-dashed border-[var(--grid-line)]">
          <span aria-hidden className="absolute -top-px -left-8 hidden size-16 rounded-full border border-dashed border-[var(--grid-line)] sm:block" />
          <div className="border-y border-dashed border-[var(--grid-line)] px-6 py-12 text-center sm:py-16">
            <h1 className="text-5xl font-semibold tracking-tight sm:text-7xl">APICenter</h1>
          </div>
          <div className="border-b border-dashed border-[var(--grid-line)] px-6 py-10 text-center">
            <p className="mx-auto max-w-2xl text-lg leading-relaxed text-fd-muted-foreground sm:text-xl">
              <span className="text-fd-foreground">One API and one key</span> for{" "}
              <span className="text-fd-foreground">email, SMS, one-time codes, Google sign-in, geolocation and payments</span>, called from your
              backend with a <span className="text-fd-foreground">server-side SDK</span>.
            </p>
          </div>
          <div className="grid border-b border-dashed border-[var(--grid-line)] sm:grid-cols-[1fr_auto_1fr]">
            <div className="hidden sm:block" />
            <div className="flex flex-col items-center gap-4 border-dashed border-[var(--grid-line)] px-8 py-10 sm:border-x">
              <div className="flex flex-wrap justify-center gap-3">
                <Link
                  href="/guides/getting-started"
                  className="inline-flex h-10 items-center gap-1.5 rounded-md bg-fd-primary px-5 text-sm font-medium text-fd-primary-foreground transition-opacity hover:opacity-85"
                >
                  Get started <ArrowRightIcon className="size-4" />
                </Link>
                <Link href="/reference/api" className="inline-flex h-10 items-center rounded-md border bg-fd-card px-5 text-sm font-medium transition-colors hover:bg-fd-accent">
                  API reference
                </Link>
              </div>
              <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-fd-muted-foreground">
                {["Test and live environments", "Explicit grants", "Signed webhooks"].map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <CheckIcon className="size-3.5 text-[var(--success)]" /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="hidden sm:block" />
          </div>
        </div>
      </section>

      {/* Quick start: three steps beside the first request. */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">From key to first request</h2>
            <p className="mt-2 text-fd-muted-foreground">Prefer HTTP? Every call is also in the REST API reference, with curl examples.</p>
            <ol className="mt-8 flex flex-col gap-6">
              {STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-xs">{index + 1}</span>
                  <div>
                    <p className="font-medium">{step.title}</p>
                    <p className="mt-0.5 text-sm text-fd-muted-foreground">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <Tabs items={["SDK", "curl"]} className="my-0">
            <Tab value="SDK">
              <Code code={SNIPPET} lang="ts" title="server.ts" />
            </Tab>
            <Tab value="curl">
              <Code code={CURL} lang="bash" title="Terminal" />
            </Tab>
          </Tabs>
        </div>
      </section>

      {/* Capabilities: a dashed grid, each cell a guide. */}
      <section className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <h2 className="mb-6 text-2xl font-semibold tracking-tight">Capabilities</h2>
        <div className="grid border-t border-l border-dashed border-[var(--grid-line)] sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((capability) => (
            <Link
              key={capability.name}
              href={capability.href}
              className="group border-r border-b border-dashed border-[var(--grid-line)] p-6 transition-colors hover:bg-fd-accent/40"
            >
              <p className="flex items-center justify-between text-lg font-semibold">
                {capability.name}
                <ArrowRightIcon className="size-4 text-fd-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-fd-muted-foreground">{capability.text}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Closing: where the work happens. */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
        <div className="border border-dashed border-[var(--grid-line)] px-6 py-14 text-center">
          <h2 className="text-xl font-semibold">Set it up in the console</h2>
          <p className="mx-auto mt-2 max-w-xl text-fd-muted-foreground">
            Projects, applications, keys, grants, quotas, webhooks and going live are managed in the APICenter console. Ask an organization admin for an invite.
          </p>
          <a href={CONSOLE_URL} className="mt-6 inline-flex h-10 items-center gap-1.5 rounded-md border bg-fd-card px-5 text-sm font-medium transition-colors hover:bg-fd-accent">
            Open the console <ArrowRightIcon className="size-4" />
          </a>
        </div>
      </section>

      <footer className="mt-auto border-t">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-fd-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex gap-5">
            <Link href="/guides/getting-started" className="hover:text-fd-foreground">
              Guides
            </Link>
            <Link href="/reference/api" className="hover:text-fd-foreground">
              API reference
            </Link>
            <Link href="/reference/events" className="hover:text-fd-foreground">
              Events
            </Link>
            <a href={CONSOLE_URL} className="hover:text-fd-foreground">
              Console
            </a>
          </div>
          <p>© {new Date().getFullYear()} Alpha Explora</p>
        </div>
      </footer>
    </main>
  );
}
