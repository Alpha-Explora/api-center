import Image from "next/image";
import Link from "next/link";
import {
  ArrowRightIcon,
  BarChart3Icon,
  Code2Icon,
  CreditCardIcon,
  CheckCircle2Icon,
  FolderOpenIcon,
  KeyRoundIcon,
  MailIcon,
  MapPinIcon,
  MessageSquareIcon,
  SearchIcon,
  SparklesIcon,
  ShieldCheckIcon,
  UserRoundCheckIcon,
  WaypointsIcon,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * Landing-page composition copied/adapted from Shreyas-29/linkify under the
 * MIT License. Styling is retained; content and previews describe APICenter.
 */

const DOCS_URL = "https://docs.apicenter.itsandbox.site";
const guideUrl = (path: string) => `${DOCS_URL}/guides/${path}`;

const navItems = [
  { label: "Platform", href: "#features" },
  { label: "Getting started", href: "#process" },
  { label: "For teams", href: "#teams" },
  { label: "Shared services", href: "#services" },
];

const sharedServices = [
  "Payments",
  "Email",
  "SMS",
  "OTP",
  "Geocoding",
  "Google sign-in",
];

const featureCards = [
  {
    icon: WaypointsIcon,
    name: "One gateway",
    description:
      "Call registered team APIs and shared services through a common entry point.",
    href: guideUrl("identity-gateway/registry-health"),
    className: "lg:col-span-1",
    background: <GatewayCard />,
  },
  {
    icon: SearchIcon,
    name: "A catalog your teams can use",
    description:
      "Find services, their owners, exposed routes, and dependencies in the registry.",
    href: guideUrl("management/register-service"),
    className: "lg:col-span-2",
    background: <RegistryCard />,
  },
  {
    icon: WaypointsIcon,
    name: "Shared services, ready to integrate",
    description:
      "Use payments, messaging, verification, location, and Google sign-in through the server-side SDK.",
    href: guideUrl("sdk-usage"),
    className: "lg:col-span-2",
    background: <SharedServicesCard />,
  },
  {
    icon: ShieldCheckIcon,
    name: "Governed access",
    description:
      "Manage service scopes, quotas, and audit records with separate test and live credentials.",
    href: guideUrl("authentication"),
    className: "lg:col-span-1",
    background: <AccessCard />,
  },
];

const process = [
  {
    title: "Register your service",
    description:
      "Get organization access, then place your service in a tribe and project. Define its routes, scopes, and dependencies.",
    icon: FolderOpenIcon,
  },
  {
    title: "Connect your backend",
    description:
      "Install the APICenter SDK and configure the service credentials issued for your environment.",
    icon: Code2Icon,
  },
  {
    title: "Call and monitor",
    description:
      "Call shared APIs from your backend. Use the console to review usage, quotas, and audit records.",
    icon: BarChart3Icon,
  },
];

const workflows = [
  {
    name: "Application developers",
    info: "Integrate shared capabilities into your backend.",
    focus: "Build with the SDK",
    features: [
      "Server-side TypeScript SDK",
      "Service authentication",
      "Shared-service namespaces",
      "Payment and event guides",
      "Separate test and live credentials",
    ],
    button: "Read the integration guide",
    href: guideUrl("sdk-usage"),
  },
  {
    name: "Platform teams",
    info: "Manage services and access across your organization.",
    focus: "Run the platform",
    featured: true,
    features: [
      "Organization-scoped console",
      "Tribe and project registry",
      "Service scopes and quotas",
      "Gateway usage and health",
      "Operational audit records",
    ],
    button: "Open the console",
    href: "/dashboard",
  },
  {
    name: "Service owners",
    info: "Make your team's APIs discoverable and governed.",
    focus: "Publish your API",
    features: [
      "Service manifests",
      "Registered routes and scopes",
      "Project and environment placement",
      "Shared-service dependencies",
      "Registration and lifecycle controls",
    ],
    button: "Read the registration guide",
    href: guideUrl("management/register-service"),
  },
];

const services = [
  {
    name: "Payments",
    label: "Checkout and payment lifecycle",
    icon: CreditCardIcon,
    description:
      "Integrate checkouts, payment intents, refunds, subscriptions, and payment events through APICenter.",
    href: guideUrl("payments/overview"),
  },
  {
    name: "Email",
    label: "Application messaging",
    icon: MailIcon,
    description:
      "Send transactional email from your backend and check delivery status through the shared email service.",
    href: guideUrl("messaging-verification/email"),
  },
  {
    name: "SMS",
    label: "Text messaging",
    icon: MessageSquareIcon,
    description:
      "Send SMS notifications and retrieve message status with service-scoped access.",
    href: guideUrl("messaging-verification/sms"),
  },
  {
    name: "OTP",
    label: "Verification",
    icon: KeyRoundIcon,
    description:
      "Request and verify one-time codes through the shared verification service.",
    href: guideUrl("messaging-verification/otp"),
  },
  {
    name: "Geocoding",
    label: "Location utilities",
    icon: MapPinIcon,
    description:
      "Look up addresses and coordinates through APICenter's location service.",
    href: guideUrl("platform-utilities/geo"),
  },
  {
    name: "Google sign-in",
    label: "Identity integration",
    icon: UserRoundCheckIcon,
    description:
      "Configure project Google sign-in and integrate Google authentication through the shared service.",
    href: guideUrl("identity-gateway/gauth"),
  },
];

export function PublicLandingPage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[#050505] text-white">
      <Navbar />
      <section id="home" className="relative px-5 sm:px-8 lg:px-12">
        <div
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(620px_circle_at_50%_20%,black,transparent_72%)]"
          aria-hidden="true"
        />
        <div className="relative mx-auto flex max-w-screen-xl flex-col items-center justify-center text-center">
          <div className="landing-reveal mt-24 flex flex-col items-center md:mt-28">
            <SparkBadge>
              APIs and shared services, governed
              <ArrowRightIcon className="ml-1 size-3 transition-transform duration-300 group-hover:translate-x-0.5" />
            </SparkBadge>
            <h1 className="w-full max-w-5xl py-6 text-balance text-center text-5xl font-medium leading-[1.08] tracking-normal text-white sm:text-6xl md:text-7xl lg:text-8xl">
              One gateway for your APIs and{" "}
              <span className="inline-block bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                shared services
              </span>
            </h1>
            <p className="mb-12 max-w-2xl text-balance text-lg leading-8 text-white/58 md:text-xl">
              Connect your team&apos;s APIs, use shared services, and manage access
              across your organization. APICenter brings service registration,
              routing, and governance into one platform.
            </p>
            <div className="z-10 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/dashboard"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-11 rounded-[8px] bg-white px-5 text-sm font-semibold text-black hover:bg-violet-100",
                )}
              >
                Open the console
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
              <a
                href={guideUrl("getting-started")}
                className="inline-flex h-11 items-center rounded-[8px] border border-white/20 px-5 text-sm font-semibold text-white/80 transition-colors hover:border-violet-300/50 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300"
              >
                Read the docs
              </a>
            </div>
          </div>

          <div className="landing-reveal relative w-full px-2 pb-20 pt-20 md:py-32">
            <div
              className="landing-dashboard-glow absolute left-1/2 top-[12%] h-48 w-3/4 -translate-x-1/2 rounded-full bg-violet-500/25 blur-[5rem]"
              aria-hidden="true"
            />
            <div className="-m-2 rounded-xl bg-white/[0.04] p-2 ring-1 ring-inset ring-white/18 backdrop-blur-3xl lg:-m-4 lg:rounded-2xl">
              <BorderBeam />
              <div className="relative overflow-hidden rounded-md border border-white/10 bg-black ring-1 ring-white/8 lg:rounded-xl">
                <ConsolePreview />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#050505] to-transparent" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <MaxWidthSection>
        <div className="py-14">
          <h2 className="text-center text-sm font-medium text-white/58">
            Shared capabilities for your applications
          </h2>
          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-6 md:gap-x-16">
            {sharedServices.map((service) => (
              <li
                key={service}
                className="text-base font-semibold text-white/75"
              >
                {service}
              </li>
            ))}
          </ul>
        </div>
      </MaxWidthSection>

      <MaxWidthSection id="features" className="pt-10">
        <SectionHeader
          badge="Features"
          title="Connect services. Control access."
          text="Give your teams a common way to discover APIs, call shared services, and manage who can use them."
        />
        <div className="grid auto-rows-[22rem] grid-cols-1 gap-4 py-8 lg:grid-cols-3">
          {featureCards.map((feature) => {
            const Icon = feature.icon;
            return (
              <BentoCard key={feature.name} className={feature.className}>
                {feature.background}
                <div className="pointer-events-none relative z-10 mt-auto flex flex-col gap-1 p-6 pb-16 transition-all duration-300 group-hover:-translate-y-10 group-focus-within:-translate-y-10 lg:pb-6">
                  <Icon className="size-11 origin-left text-neutral-700 transition-all duration-300 group-hover:scale-75" />
                  <h3 className="text-xl font-semibold text-neutral-300">
                    {feature.name}
                  </h3>
                  <p className="max-w-lg text-sm leading-6 text-neutral-400">
                    {feature.description}
                  </p>
                </div>
                <div className="absolute bottom-0 flex w-full items-center p-4 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 lg:translate-y-10 lg:opacity-0">
                  <a
                    href={feature.href}
                    className="inline-flex items-center rounded text-sm font-semibold text-violet-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300"
                    aria-label={`Read about ${feature.name}`}
                  >
                    Learn more
                    <ArrowRightIcon className="ml-2 size-4" />
                  </a>
                </div>
              </BentoCard>
            );
          })}
        </div>
      </MaxWidthSection>

      <MaxWidthSection id="process" className="py-10">
        <SectionHeader
          badge="Getting started"
          title="Bring your service into APICenter"
          text="Start with organization access and service registration, then connect your backend to the APIs it needs."
        />
        <div className="grid w-full gap-4 py-8 md:grid-cols-2 md:gap-8 lg:grid-cols-3">
          {process.map((item, index) => {
            const Icon = item.icon;
            return (
              <MagicCard key={item.title} className="group md:py-8">
                <div className="flex w-full flex-col items-start justify-center">
                  <Icon className="size-10 text-white/88" strokeWidth={1.5} />
                  <div className="relative flex flex-col items-start">
                    <span className="absolute -top-6 right-0 flex size-12 items-center justify-center rounded-full border-2 border-white/14 pt-0.5 text-2xl font-medium text-white/84">
                      {index + 1}
                    </span>
                    <h3 className="mt-6 text-base font-medium text-white">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-white/52">
                      {item.description}
                    </p>
                  </div>
                </div>
              </MagicCard>
            );
          })}
        </div>
      </MaxWidthSection>

      <MaxWidthSection id="teams" className="py-10">
        <SectionHeader
          badge="For teams"
          title="A shared platform for every team"
          text="Application developers, platform teams, and service owners work from the same registry and access rules."
        />
        <div className="grid gap-4 py-8 lg:grid-cols-3">
          {workflows.map((plan) => (
            <article
              key={plan.name}
              className={cn(
                "rounded-[14px] border bg-black p-6",
                plan.featured
                  ? "border-violet-400/50 shadow-[0_0_0_1px_rgba(167,139,250,0.18),0_24px_90px_rgba(139,92,246,0.16)]"
                  : "border-white/10",
              )}
            >
              <div className="text-sm font-medium text-white/60">
                {plan.name}
              </div>
              <div className="mt-1 min-h-10 text-sm text-white/42">{plan.info}</div>
              <h3 className="mt-5 text-3xl font-semibold">{plan.focus}</h3>
              <Link
                href={plan.href}
                className={cn(
                  buttonVariants({ size: "sm" }),
                  "mt-6 h-9 w-full rounded-[8px] text-xs font-semibold",
                  plan.featured
                    ? "bg-violet-500 text-white hover:bg-violet-400"
                    : "bg-white text-black hover:bg-violet-100",
                )}
              >
                {plan.button}
              </Link>
              <ul className="mt-6 space-y-3 text-sm text-white/64">
                {plan.features.map((item) => (
                  <li key={item} className="flex items-center gap-2">
                    <CheckCircle2Icon className="size-4 text-violet-300" />
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-sm text-white/54">
          <CheckCircle2Icon className="size-5 text-violet-300" />
          <span>Access is managed by your organization</span>
        </div>
      </MaxWidthSection>

      <MaxWidthSection id="services" className="py-10">
        <SectionHeader
          badge="Shared services"
          title="Common capabilities, one integration"
          text="Use APICenter's shared services from your backend. Follow each integration guide for setup and provider requirements."
        />
        <div className="grid grid-cols-1 gap-4 py-10 md:grid-cols-2 md:gap-8 lg:grid-cols-3">
          {services.map((service) => {
            const Icon = service.icon;
            return (
              <MagicCard key={service.name} className="p-0">
                <article className="flex h-full flex-col p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-violet-200">
                      <Icon className="size-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h3 className="text-base font-medium text-white/85">
                        {service.name}
                      </h3>
                      <p className="text-sm text-white/52">{service.label}</p>
                    </div>
                  </div>
                  <p className="mt-5 text-sm leading-6 text-white/65">
                    {service.description}
                  </p>
                  <a
                    href={service.href}
                    className="mt-auto inline-flex items-center gap-2 rounded pt-6 text-sm font-medium text-violet-200 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-violet-300"
                    aria-label={"Read the " + service.name + " guide"}
                  >
                    Read the guide{" "}
                    <ArrowRightIcon className="size-4" aria-hidden="true" />
                  </a>
                </article>
              </MagicCard>
            );
          })}
        </div>
      </MaxWidthSection>

      <MaxWidthSection className="mt-10 max-w-[100vw] overflow-x-hidden pb-24">
        <LampSection />
      </MaxWidthSection>

      <Footer />
    </main>
  );
}

function Navbar() {
  return (
    <header className="sticky inset-x-0 top-0 z-50 h-14 w-full border-b border-transparent bg-[#050505]/70 backdrop-blur-md">
      <div className="mx-auto flex size-full max-w-screen-xl items-center justify-between px-5 md:px-12 lg:px-20">
        <div className="flex items-center gap-12">
          <Link href="/#home" className="flex items-center gap-3">
            <Image
              src="/brand/apicenter-geometric-mark-light.svg"
              alt=""
              aria-hidden="true"
              width={32}
              height={32}
              className="size-8"
            />
            <span className="text-lg font-bold leading-none">APICenter</span>
          </Link>
          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-7 text-sm text-white/58 lg:flex"
          >
            {navItems.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="transition-colors hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="hidden text-sm font-medium text-white/58 transition-colors hover:text-white sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href={guideUrl("getting-started")}
            className={cn(
              buttonVariants({ size: "sm" }),
              "h-9 rounded-[8px] bg-white px-4 text-xs font-semibold text-black hover:bg-violet-100",
            )}
          >
            Read the docs
          </Link>
        </div>
      </div>
    </header>
  );
}

function MaxWidthSection({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "mx-auto h-full w-full max-w-screen-xl px-5 md:px-12 lg:px-20",
        className,
      )}
    >
      {children}
    </section>
  );
}

function SectionHeader({
  badge,
  title,
  text,
}: {
  badge: string;
  title: string;
  text: string;
}) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center justify-center py-8 text-center">
      <MagicBadge title={badge} />
      <h2 className="mt-6 text-3xl font-medium leading-[1.1] text-white md:text-5xl">
        {title}
      </h2>
      <p className="mt-4 max-w-lg text-lg text-white/54">{text}</p>
    </div>
  );
}

function SparkBadge({ children }: { children: React.ReactNode }) {
  return (
    <div className="group relative inline-grid overflow-hidden rounded-full px-4 py-1 shadow-[0_1000px_0_0_rgba(255,255,255,0.12)_inset] transition-colors duration-200">
      <span className="landing-badge-spark absolute inset-0 rounded-full" />
      <span className="absolute inset-[1px] rounded-full bg-[#07070a]" />
      <span className="relative z-10 flex items-center justify-center gap-1 py-0.5 text-sm text-white/86">
        <SparklesIcon className="size-3.5 text-violet-300" />
        {children}
      </span>
    </div>
  );
}

function MagicBadge({ title }: { title: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/12 bg-white/[0.045] px-3 py-1 text-sm font-medium text-violet-200">
      {title}
    </span>
  );
}

function BorderBeam() {
  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-xl bg-[linear-gradient(90deg,transparent,rgba(167,139,250,0.62),transparent)] opacity-50 [mask-image:linear-gradient(to_right,transparent_0%,black_42%,black_58%,transparent_100%)]"
      aria-hidden="true"
    />
  );
}

function BentoCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <article
      className={cn(
        "group relative col-span-1 flex flex-col justify-between overflow-hidden rounded-xl border border-white/10 bg-black shadow-[0_-20px_80px_-20px_rgba(255,255,255,0.12)_inset]",
        className,
      )}
    >
      {children}
      <div className="pointer-events-none absolute inset-0 transition-colors duration-300 group-hover:bg-white/[0.025]" />
    </article>
  );
}

function MagicCard({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[12px] border border-white/10 bg-white/[0.045] p-6 transition-colors duration-200 hover:border-violet-300/40",
        className,
      )}
    >
      {children}
    </div>
  );
}

function GatewayCard() {
  return (
    <div
      aria-hidden="true"
      className="absolute left-10 top-10 w-[78%] origin-top rounded-md border border-white/10 bg-[#050505] p-4 transition-all duration-300 [mask-image:linear-gradient(to_top,transparent_0%,#000_100%)] group-hover:scale-105"
    >
      <div className="text-base font-medium text-white">Your application</div>
      <div className="my-3 h-5 border-l border-dashed border-violet-300/50" />
      <div className="rounded-[8px] border border-violet-400/30 bg-violet-500/10 px-3 py-2 text-sm text-violet-200">
        APICenter gateway
      </div>
      <div className="my-3 h-5 border-l border-dashed border-violet-300/50" />
      <div className="text-sm text-white/60">
        Registered APIs + shared services
      </div>
    </div>
  );
}

function RegistryCard() {
  return (
    <div
      aria-hidden="true"
      className="absolute right-10 top-10 w-[70%] origin-top rounded-md border border-white/10 bg-[#050505] p-3 transition-all duration-300 [mask-image:linear-gradient(to_top,transparent_40%,#000_100%)] group-hover:-translate-x-10"
    >
      <div className="rounded-[7px] border border-white/10 bg-white/[0.045] px-3 py-2 text-sm text-white/65">
        Organization / Tribe / Project
      </div>
      <div className="mt-2 space-y-1 text-sm text-white/65">
        {[
          "Service registry",
          "Exposed API routes",
          "Required scopes",
          "Shared-service dependencies",
          "Test and live environments",
        ].map((item) => (
          <div
            key={item}
            className="flex items-center gap-3 rounded-md px-3 py-2"
          >
            <FolderOpenIcon className="size-4 text-violet-300" />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function SharedServicesCard() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-x-5 top-4 grid h-[220px] grid-cols-3 gap-3 border-none transition-all duration-300 [mask-image:linear-gradient(to_top,transparent_10%,#000_100%)] group-hover:scale-105 lg:left-auto lg:right-2 lg:h-[300px] lg:w-[600px]"
    >
      {sharedServices.map((name) => (
        <div
          key={name}
          className="flex h-20 items-center justify-center rounded-[10px] border border-white/10 bg-white/[0.045] px-2 text-center text-sm font-semibold text-white/70"
        >
          {name}
        </div>
      ))}
    </div>
  );
}

function AccessCard() {
  return (
    <div
      aria-hidden="true"
      className="absolute right-0 top-10 w-[86%] origin-top rounded-md border border-white/10 bg-[#050505] p-4 transition-all duration-300 [mask-image:linear-gradient(to_top,transparent_20%,#000_100%)] group-hover:scale-105"
    >
      <div className="text-sm font-medium text-white/75">Service access</div>
      <div className="mt-4 space-y-3 text-sm text-white/65">
        {[
          "Authenticated service",
          "Required scopes",
          "Quota policy",
          "Audit record",
        ].map((label) => (
          <div
            key={label}
            className="flex items-center gap-3 rounded-md border border-white/10 p-2"
          >
            <ShieldCheckIcon className="size-4 text-violet-300" />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ConsolePreview() {
  return (
    <div
      role="img"
      aria-label="Illustrative APICenter console preview showing a service registry, shared services, and governed API access"
      className="bg-[#09090c] text-left"
    >
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-5 py-4 md:px-8">
        <div className="flex items-center gap-3">
          <Image
            src="/brand/apicenter-geometric-mark-light.svg"
            alt=""
            width={24}
            height={24}
          />
          <span className="text-sm font-semibold">APICenter</span>
          <span className="hidden text-sm text-white/50 sm:inline">
            Management console
          </span>
        </div>
        <span className="rounded-full border border-violet-300/25 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">
          Illustrative preview
        </span>
      </div>
      <div className="grid md:min-h-[420px] md:grid-cols-[180px_1fr] lg:grid-cols-[210px_1fr]">
        <div className="hidden border-r border-white/10 px-4 py-6 md:block">
          {[
            "Dashboard",
            "Service registry",
            "Shared services",
            "Quotas",
            "Audit",
          ].map((item) => (
            <div
              key={item}
              className={cn(
                "mb-2 rounded-md px-3 py-3 text-sm",
                item === "Service registry"
                  ? "bg-violet-500/15 text-violet-200"
                  : "text-white/55",
              )}
            >
              {item}
            </div>
          ))}
        </div>
        <div className="min-w-0 p-5 md:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs text-white/50">
                Organization / Tribe / Project
              </div>
              <div className="mt-2 text-xl font-semibold md:text-2xl">
                Service registry
              </div>
            </div>
            <span className="rounded-md border border-white/15 px-3 py-2 text-xs text-white/65">
              Environment: test
            </span>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              ["Discover", "Registered APIs"],
              ["Integrate", "Shared services"],
              ["Govern", "Scopes and quotas"],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-white/10 bg-white/[0.025] p-4"
              >
                <div className="text-xs text-white/55">{label}</div>
                <div className="mt-2 text-sm font-medium text-white/85">
                  {value}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 overflow-hidden rounded-lg border border-white/10">
            <div className="grid grid-cols-[1fr_1fr] gap-3 border-b border-white/10 bg-white/[0.025] px-4 py-3 text-xs text-white/55 sm:grid-cols-[1fr_1fr_1fr]">
              <span>Service</span>
              <span>Capability</span>
              <span className="hidden sm:block">Access</span>
            </div>
            {[
              ["payments", "Checkout and billing"],
              ["email", "Transactional email"],
              ["otp", "Verification codes"],
            ].map(([name, capability]) => (
              <div
                key={name}
                className="grid grid-cols-[1fr_1fr] gap-3 border-b border-white/5 px-4 py-4 text-sm sm:grid-cols-[1fr_1fr_1fr]"
              >
                <span className="text-white/80">{name}</span>
                <span className="text-white/55">{capability}</span>
                <span className="hidden text-violet-200 sm:block">
                  Service-scoped
                </span>
              </div>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-white/55">
            <ShieldCheckIcon
              className="size-4 text-violet-300"
              aria-hidden="true"
            />
            Service credentials<span aria-hidden="true">/</span>Required scopes
            <span aria-hidden="true">/</span>Usage quotas
          </div>
        </div>
      </div>
    </div>
  );
}

function LampSection() {
  return (
    <div className="relative flex w-full flex-col items-center justify-center overflow-hidden rounded-[14px] border border-white/10 bg-[radial-gradient(42%_180px_at_50%_0%,rgba(139,92,246,0.34),transparent),#08080a] px-6 py-20 text-center">
      <div className="absolute top-0 h-px w-3/4 bg-gradient-to-r from-transparent via-violet-300 to-transparent" />
      <h2 className="mt-8 bg-gradient-to-b from-neutral-200 to-neutral-400 bg-clip-text py-4 text-center text-4xl font-medium leading-[1.15] tracking-normal text-transparent md:text-7xl">
        Connect your next service
      </h2>
      <p className="mx-auto mt-6 max-w-md text-white/54">
        Register your API, connect the server-side SDK, and use the shared
        services your application needs.
      </p>
      <div className="mt-6">
        <Link
          href={guideUrl("getting-started")}
          className={cn(
            buttonVariants({ size: "lg" }),
            "h-11 rounded-[8px] bg-white px-5 text-sm font-semibold text-black hover:bg-violet-100",
          )}
        >
          Read the getting started guide
          <ArrowRightIcon data-icon="inline-end" />
        </Link>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10 px-5 py-12 md:px-12 lg:px-20">
      <div className="mx-auto flex max-w-screen-xl flex-col gap-8 md:flex-row md:items-center md:justify-between">
        <Link href="/#home" className="flex items-center gap-3">
          <Image
            src="/brand/apicenter-geometric-mark-light.svg"
            alt=""
            aria-hidden="true"
            width={28}
            height={28}
            className="size-7"
          />
          <span className="text-lg font-bold">APICenter</span>
        </Link>
        <div className="flex flex-wrap gap-x-7 gap-y-3 text-sm text-white/50">
          {navItems.map((item) => (
            <a key={item.label} href={item.href} className="hover:text-white">
              {item.label}
            </a>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-12 max-w-screen-xl text-center text-6xl font-semibold tracking-normal text-white/[0.04] md:text-9xl">
        APICENTER
      </div>
    </footer>
  );
}
