import Link from "next/link";
import type { ReactNode } from "react";
import {
  AppWindowIcon,
  BlocksIcon,
  ChevronsUpDownIcon,
  CreditCardIcon,
  FolderIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  MailIcon,
  MapPinIcon,
  MessageSquareIcon,
  PlusIcon,
  SearchIcon,
  UserRoundCheckIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { CopyButton } from "@/components/patterns/copy-button";
import { Kbd } from "@/components/patterns/form";
import { StatusBadge } from "@/components/patterns/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const DOCS_URL = "https://docs.apicenter.itsandbox.site";
const guideUrl = (path: string) => `${DOCS_URL}/guides/${path}`;
const GETTING_STARTED_URL = guideUrl("getting-started");
const INSTALL_COMMAND = "npm install @alpha-explora/apicenter-sdk";

const navItems = [
  { label: "Platform", href: "#features" },
  { label: "Getting started", href: "#process" },
  { label: "For teams", href: "#teams" },
  { label: "Shared services", href: "#services" },
];

const pressable = "transition-[background-color,color,transform] active:translate-y-px motion-reduce:transition-none motion-reduce:active:translate-y-0";
const primaryAction = cn(buttonVariants({ size: "lg" }), "h-10 px-4 text-sm", pressable);
const secondaryAction = cn(buttonVariants({ size: "lg", variant: "outline" }), "h-10 px-4 text-sm", pressable);
const textLink =
  "font-medium text-foreground underline decoration-border underline-offset-4 transition-[text-decoration-color] hover:decoration-foreground motion-reduce:transition-none";

const platform: { name: string; description: string; href: string; fragment: ReactNode }[] = [
  {
    name: "Test and live environments",
    description: "Every project has a test environment. Live is activated only after a second person approves it.",
    href: guideUrl("management/access-and-tenancy"),
    fragment: <EnvironmentFragment />,
  },
  {
    name: "Grants and application keys",
    description: "Nothing is allowed by default. An application calls only the actions it was granted, with a key shown once.",
    href: guideUrl("authentication"),
    fragment: <GrantFragment />,
  },
  {
    name: "One server-side SDK",
    description: "The key's prefix selects the environment, so APICENTER_API_KEY is the only setting your backend needs.",
    href: guideUrl("sdk-usage"),
    fragment: <WhoamiFragment />,
  },
  {
    name: "Signed payment events",
    description: "Payment events arrive at your HTTPS endpoint, signed, so you can mark an order paid once.",
    href: guideUrl("events/webhooks"),
    fragment: <EventFragment />,
  },
];

const steps = [
  { title: "Create a project", description: "It starts with a test environment. Live follows after approval." },
  { title: "Enable capabilities", description: "Turn on the shared services the environment uses, such as email or payments." },
  { title: "Add an application and grant actions", description: "One application per backend, granted only the actions it calls." },
  { title: "Issue a key and call the gateway", description: "The key is shown once. Keep it in your backend's secret store." },
];

const roles = [
  { role: "Owner", can: "Everything, including managing owners" },
  { role: "Admin", can: "Members, teams, projects, live environments and approvals" },
  { role: "Developer", can: "Create projects and configure test; read live" },
  { role: "Viewer", can: "Read" },
];

const services: { name: string; icon: LucideIcon; description: string; actions: string[]; href: string }[] = [
  {
    name: "Payments",
    icon: CreditCardIcon,
    description: "Checkouts, payment intents, payment links, customers, subscriptions and refunds.",
    actions: ["payments:checkout:write", "payments:refunds:write"],
    href: guideUrl("payments/overview"),
  },
  {
    name: "Email",
    icon: MailIcon,
    description: "Send transactional email and read the delivery status of what you sent.",
    actions: ["email:send", "email:read"],
    href: guideUrl("messaging-verification/email"),
  },
  {
    name: "SMS",
    icon: MessageSquareIcon,
    description: "Send text messages and read their delivery status.",
    actions: ["sms:send", "sms:read"],
    href: guideUrl("messaging-verification/sms"),
  },
  {
    name: "OTP",
    icon: KeyRoundIcon,
    description: "Generate and deliver one-time codes, then verify them.",
    actions: ["otp:generate", "otp:verify"],
    href: guideUrl("messaging-verification/otp"),
  },
  {
    name: "Geolocation",
    icon: MapPinIcon,
    description: "Geocode addresses, reverse-geocode coordinates and check geofences.",
    actions: ["geo:geocode", "geo:geofence"],
    href: guideUrl("platform-utilities/geo"),
  },
  {
    name: "Google sign-in",
    icon: UserRoundCheckIcon,
    description: "Start Google sign-in for your users and exchange or refresh their tokens.",
    actions: ["gauth:authorize", "gauth:token"],
    href: guideUrl("identity-gateway/gauth"),
  },
];

export function PublicLandingPage() {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <Header />
      <main>
        <section id="home" className="scroll-mt-14 overflow-hidden">
          <Container className="pt-16 md:pt-24">
            <h1 className="max-w-3xl text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-5xl lg:text-[4rem]">
              One gateway for your APIs and shared services
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
              Your backend reaches email, SMS, one-time codes, geolocation, Google sign-in and payments with one API key.
              Each project keeps test and live apart, and each application calls only what you grant it.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href="/projects" className={primaryAction}>
                Open the console
              </Link>
              <a href={GETTING_STARTED_URL} className={secondaryAction}>
                Read the docs
              </a>
              <div className="flex h-10 min-w-0 items-center gap-2 rounded-md border border-dashed px-3 font-mono text-xs text-muted-foreground sm:ml-2">
                <span aria-hidden className="select-none text-muted-foreground/60">$</span>
                <span className="truncate">{INSTALL_COMMAND}</span>
                <CopyButton value={INSTALL_COMMAND} label="Copy the install command" className="-mr-1.5 ml-auto" />
              </div>
            </div>
          </Container>
          <div className="relative mt-14 md:mt-20">
            <div aria-hidden className="absolute inset-x-0 top-24 bottom-0 border-t bg-muted/40" />
            <Container className="relative pb-16 md:pb-24">
              <ConsolePreview />
            </Container>
          </div>
        </section>

        <Section
          id="features"
          title="Projects, environments and applications"
          description="The console and the gateway share one model. Access is decided at every request, from the organization down to the action."
        >
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 font-mono text-xs" aria-label="Resource hierarchy">
            {["Organization", "Project", "Environment", "Application", "Grants and keys"].map((name, index) => (
              <li key={name} className="flex items-center gap-2">
                {index > 0 ? <span aria-hidden className="hidden h-px w-6 bg-border sm:block" /> : null}
                <span className="rounded-md border bg-card px-2.5 py-1.5 shadow-xs">{name}</span>
              </li>
            ))}
          </ol>
          <div className="mt-10 grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {platform.map((item) => (
              <article key={item.name} className="flex flex-col bg-card p-5">
                <div className="flex h-28 flex-col justify-center rounded-md border bg-background px-3">{item.fragment}</div>
                <h3 className="mt-5 text-sm font-semibold">{item.name}</h3>
                <p className="mt-1.5 flex-1 text-[13px] leading-5 text-muted-foreground">{item.description}</p>
                <a href={item.href} aria-label={`Read about ${item.name}`} className={cn(textLink, "mt-4 self-start text-[13px]")}>
                  Read the guide
                </a>
              </article>
            ))}
          </div>
        </Section>

        <Section
          id="process"
          title="Four steps to your first request"
          description="Set up the project in the console, then call the gateway from your backend with the SDK."
        >
          <div className="grid gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
            <ol className="flex flex-col">
              {steps.map((step, index) => (
                <li key={step.title} className="flex gap-4 border-b py-4 first:pt-0 last:border-b-0">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border bg-card font-mono text-xs text-muted-foreground">
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold">{step.title}</h3>
                    <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
            <CodeSample />
          </div>
        </Section>

        <Section
          id="teams"
          title="Roles for the people on your team"
          description="People sign in with Google and get one organization role. Teams and project roles give access to single projects."
        >
          <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
            <div className="overflow-hidden rounded-lg border bg-card">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="h-9 px-4 font-medium">Role</th>
                    <th className="h-9 px-4 font-medium">Can</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((entry) => (
                    <tr key={entry.role} className="border-b last:border-b-0">
                      <td className="h-10 px-4 font-medium whitespace-nowrap">{entry.role}</td>
                      <td className="h-10 px-4 text-muted-foreground">{entry.can}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="flex flex-col gap-5 text-[13px] leading-5">
              <TeamRule title="Live changes need a project admin">
                Developers configure test freely and read live, so production stays with the people who own it.
              </TeamRule>
              <TeamRule title="Going live takes two people">
                The person who requests a live environment cannot also approve it.
              </TeamRule>
              <TeamRule title="Roles shape the console">
                An action your role does not allow stays visible, disabled, with the reason beside it.
              </TeamRule>
            </ul>
          </div>
        </Section>

        <Section
          id="services"
          title="Six shared services behind one key"
          description="Enable a service in an environment, grant its actions to an application, and call it through the SDK."
        >
          <div className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {services.map((service) => (
              <article key={service.name} className="flex flex-col bg-card p-5">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-7 items-center justify-center rounded-md border bg-background">
                    <service.icon aria-hidden className="size-3.5 text-muted-foreground" />
                  </span>
                  <h3 className="text-sm font-semibold">{service.name}</h3>
                </div>
                <p className="mt-3 flex-1 text-[13px] leading-5 text-muted-foreground">{service.description}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {service.actions.map((action) => (
                    <code key={action} className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {action}
                    </code>
                  ))}
                </div>
                <a href={service.href} aria-label={`Read the ${service.name} guide`} className={cn(textLink, "mt-4 self-start text-[13px]")}>
                  Read the guide
                </a>
              </article>
            ))}
          </div>
        </Section>

        <section className="border-t">
          <Container className="flex flex-col gap-6 py-20 md:flex-row md:items-end md:justify-between md:py-24">
            <div className="max-w-xl">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Start in the test environment</h2>
              <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
                Create a project, grant your backend the actions it needs, and send a first request with a test key.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/projects" className={primaryAction}>
                Open the console
              </Link>
              <a href={GETTING_STARTED_URL} className={secondaryAction}>
                Read the docs
              </a>
            </div>
          </Container>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8", className)}>{children}</div>;
}

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-14 border-t">
      <Container className="py-20 md:py-28">
        <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h2>
        <p className="mt-3 max-w-2xl text-[15px] leading-7 text-muted-foreground">{description}</p>
        <div className="mt-10 md:mt-12">{children}</div>
      </Container>
    </section>
  );
}

function Logo() {
  return (
    <Link href="/#home" className="flex items-center gap-2 rounded-md text-sm font-semibold">
      <BrandMark />
      APICenter
    </Link>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <Container className="flex h-14 items-center gap-8">
        <Logo />
        <nav aria-label="Main navigation" className="hidden items-center gap-6 text-[13px] text-muted-foreground md:flex">
          {navItems.map((item) => (
            <a key={item.href} href={item.href} className="transition-colors hover:text-foreground motion-reduce:transition-none">
              {item.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <a href={GETTING_STARTED_URL} className={cn(buttonVariants({ variant: "ghost" }), "hidden sm:inline-flex", pressable)}>
            Read the docs
          </a>
          <Link href="/projects" className={cn(buttonVariants(), pressable)}>
            Open the console
          </Link>
        </div>
      </Container>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t">
      <Container className="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <Logo />
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted-foreground">
          {navItems.map((item) => (
            <a key={item.href} href={item.href} className="transition-colors hover:text-foreground motion-reduce:transition-none">
              {item.label}
            </a>
          ))}
          <a href={DOCS_URL} className="transition-colors hover:text-foreground motion-reduce:transition-none">
            Documentation
          </a>
        </div>
      </Container>
    </footer>
  );
}

function TeamRule({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li className="border-l-2 pl-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 text-muted-foreground">{children}</p>
    </li>
  );
}

function CodeSample() {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
      <div className="flex h-10 items-center gap-4 border-b px-4 font-mono text-xs text-muted-foreground">
        <span className="text-foreground">server.ts</span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-6">
        <code>
          <Line muted>{"import { ApiCenter } from '@alpha-explora/apicenter-sdk';"}</Line>
          <Line> </Line>
          <Line muted>{"// Reads APICENTER_API_KEY=ak_test_… from the environment."}</Line>
          <Line>{"const api = new ApiCenter();"}</Line>
          <Line> </Line>
          <Line>{"await api.email.send({"}</Line>
          <Line>{"  to: 'person@example.com',"}</Line>
          <Line>{"  subject: 'Your order is ready',"}</Line>
          <Line>{"  text: 'Your order is ready for pickup.',"}</Line>
          <Line>{"});"}</Line>
        </code>
      </pre>
      <div className="flex items-start gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
        <StatusBadge tone="danger">ACTION_NOT_GRANTED</StatusBadge>
        <span className="pt-0.5">What the call returns if the application was not granted email:send.</span>
      </div>
    </div>
  );
}

function Line({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return <span className={cn("block whitespace-pre", muted && "text-muted-foreground")}>{children}</span>;
}

/* Small console fragments for the platform section. */

function EnvironmentFragment() {
  return (
    <div className="flex flex-col gap-2">
      <EnvironmentSwitchPreview value="live" />
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <StatusBadge status="pending">pending</StatusBadge>
        <span className="truncate">Awaiting a second approver</span>
      </div>
    </div>
  );
}

function GrantFragment() {
  return (
    <dl className="flex flex-col gap-2 font-mono text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <dt className="truncate">email:send</dt>
        <dd>
          <StatusBadge status="active">granted</StatusBadge>
        </dd>
      </div>
      <div className="flex items-center justify-between gap-2">
        <dt className="truncate text-muted-foreground">otp:verify</dt>
        <dd>
          <StatusBadge tone="neutral">not granted</StatusBadge>
        </dd>
      </div>
    </dl>
  );
}

function WhoamiFragment() {
  return (
    <div className="font-mono text-[11px] leading-5">
      <div className="text-muted-foreground">{"> await api.whoami()"}</div>
      <div>{"project: 'checkout'"}</div>
      <div>{"environment: 'test'"}</div>
      <div className="truncate">{"grants: ['email:send', …]"}</div>
    </div>
  );
}

function EventFragment() {
  return (
    <div className="flex flex-col gap-2 text-[11px]">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono">payment.checkout.paid</span>
        <StatusBadge status="active">200</StatusBadge>
      </div>
      <div className="truncate font-mono text-muted-foreground">POST https://shop.example/hooks</div>
    </div>
  );
}

function EnvironmentSwitchPreview({ value }: { value: "test" | "live" }) {
  return (
    <div className="grid grid-cols-2 gap-0.5 rounded-md bg-sidebar-accent p-0.5">
      {(["test", "live"] as const).map((kind) => {
        const selected = value === kind;
        return (
          <span
            key={kind}
            className={cn(
              "flex h-7 items-center justify-center gap-1.5 rounded-[5px] text-xs font-medium text-muted-foreground",
              selected && "bg-card text-foreground shadow-xs dark:bg-input/40",
              selected && kind === "live" && "text-live",
            )}
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", kind === "live" ? "bg-live" : "bg-muted-foreground/60")} />
            {kind === "test" ? "Test" : "Live"}
          </span>
        );
      })}
    </div>
  );
}

/* The hero preview: the console's application page, built from the console's own components and tokens. */

const previewGrants = [
  { action: "email:send", capability: "Email", description: "Send an email", granted: "3 days ago" },
  { action: "otp:generate", capability: "One-time passwords", description: "Generate and deliver a one-time password", granted: "3 days ago" },
  { action: "otp:verify", capability: "One-time passwords", description: "Verify a one-time password", granted: "3 days ago" },
  { action: "payments:checkout:write", capability: "Payments", description: "Create and cancel checkout sessions", granted: "yesterday" },
  { action: "payments:checkout:read", capability: "Payments", description: "Read checkout sessions", granted: "yesterday" },
];

function ConsolePreview() {
  return (
    <div
      role="img"
      aria-label="The APICenter console showing the actions granted to an application in a project's test environment"
      className="flex overflow-hidden rounded-xl border bg-background text-left shadow-[0_1px_2px_rgb(0_0_0/0.04),0_16px_48px_-12px_rgb(0_0_0/0.16)] select-none lg:h-[540px] dark:shadow-[0_16px_48px_-12px_rgb(0_0_0/0.6)]"
    >
      <aside aria-hidden className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex flex-col gap-2 p-3">
          <div className="flex h-10 items-center gap-2.5 px-1.5">
            <BrandMark />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] leading-4 font-semibold text-foreground">Acme</span>
              <span className="truncate text-[11px] leading-4 text-muted-foreground">APICenter</span>
            </span>
            <ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
          </div>
          <div className="flex h-8 items-center gap-2 rounded-md border bg-card px-2.5 text-[13px] text-muted-foreground shadow-xs dark:bg-input/20">
            <SearchIcon className="size-3.5" />
            <span className="flex-1">Search…</span>
            <Kbd>⌘K</Kbd>
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-5 px-3">
          <div className="flex flex-col gap-px">
            <PreviewNav icon={FolderIcon} label="Projects" />
            <PreviewNav icon={UsersIcon} label="People" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Project</div>
            <div className="flex h-8 items-center gap-2 rounded-md border bg-card px-2.5 text-[13px] font-medium text-foreground shadow-xs dark:bg-input/20">
              <span className="flex-1 truncate">Checkout</span>
              <ChevronsUpDownIcon className="size-3.5 text-muted-foreground" />
            </div>
            <EnvironmentSwitchPreview value="test" />
            <div className="flex flex-col gap-px">
              <PreviewNav icon={LayoutDashboardIcon} label="Overview" />
              <PreviewNav icon={AppWindowIcon} label="Applications" active />
              <PreviewNav icon={BlocksIcon} label="Capabilities" />
            </div>
          </div>
        </div>
        <div className="border-t p-3">
          <div className="flex h-10 items-center gap-2.5 px-1.5">
            <span className="flex size-6 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">AR</span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[13px] leading-4 font-medium text-foreground">Alex Rivera</span>
              <span className="truncate text-[11px] leading-4 text-muted-foreground">alex@acme.example</span>
            </span>
          </div>
        </div>
      </aside>

      <div aria-hidden className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-1.5 border-b px-4 text-[13px] text-muted-foreground sm:px-6">
          <span className="hidden sm:inline">Checkout</span>
          <span className="hidden text-muted-foreground/50 sm:inline">/</span>
          <span>Test</span>
          <span className="text-muted-foreground/50">/</span>
          <span>Applications</span>
          <span className="text-muted-foreground/50">/</span>
          <span className="truncate text-foreground">API server</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-4 py-6 sm:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="text-xl font-semibold tracking-tight text-foreground">API server</div>
              <div className="mt-1 text-[13px] text-muted-foreground">The checkout backend. Calls email, one-time passwords and payments.</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge status="active" />
                <span className="font-mono">api-server</span>
              </div>
            </div>
            <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "hidden self-start sm:inline-flex sm:self-auto")}>
              <KeyRoundIcon data-icon="inline-start" /> Issue key
            </span>
          </div>

          <div className="flex gap-5 border-b text-[13px]">
            <span className="-mb-px border-b-2 border-foreground pb-2 font-medium text-foreground">Access</span>
            <span className="pb-2 text-muted-foreground">Keys</span>
          </div>

          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-foreground">Capability access</div>
                <div className="mt-0.5 hidden text-[13px] text-muted-foreground sm:block">
                  Each action must be granted explicitly. Revoking takes effect on the next request.
                </div>
              </div>
              <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "shrink-0")}>
                <PlusIcon data-icon="inline-start" /> Grant actions
              </span>
            </div>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="h-9 px-4 font-medium">Action</th>
                  <th className="hidden h-9 px-4 font-medium sm:table-cell">Capability</th>
                  <th className="hidden h-9 px-4 font-medium xl:table-cell">Description</th>
                  <th className="hidden h-9 px-4 font-medium md:table-cell">Granted</th>
                  <th className="h-9 w-0 px-4" />
                </tr>
              </thead>
              <tbody>
                {previewGrants.map((grant) => (
                  <tr key={grant.action} className="border-b last:border-b-0">
                    <td className="h-10 px-4 font-mono text-xs text-foreground">{grant.action}</td>
                    <td className="hidden h-10 px-4 whitespace-nowrap text-foreground sm:table-cell">{grant.capability}</td>
                    <td className="hidden h-10 max-w-xs truncate px-4 text-muted-foreground xl:table-cell">{grant.description}</td>
                    <td className="hidden h-10 px-4 whitespace-nowrap text-muted-foreground md:table-cell">{grant.granted}</td>
                    <td className="h-10 px-4 text-right">
                      <span className={buttonVariants({ variant: "ghost", size: "sm" })}>Revoke</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewNav({ icon: Icon, label, active = false }: { icon: LucideIcon; label: string; active?: boolean }) {
  return (
    <span
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px]",
        active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-sidebar-foreground",
      )}
    >
      <Icon className={cn("size-4", active ? "text-foreground" : "text-muted-foreground")} />
      {label}
    </span>
  );
}
