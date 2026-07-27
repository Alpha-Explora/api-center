import Image from "next/image";
import Link from "next/link";
import {
  ArrowRightIcon,
  BarChart3Icon,
  CalendarIcon,
  CheckCircle2Icon,
  FolderOpenIcon,
  Link2Icon,
  SearchIcon,
  SparklesIcon,
  StarIcon,
  WandSparklesIcon,
  WaypointsIcon,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * Landing-page composition copied/adapted from Shreyas-29/linkify under the
 * MIT License. Auth routes are mapped locally so this app can preview it.
 */

const navItems = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "Testimonials", href: "#reviews" },
  { label: "Process", href: "#process" },
];

const companies = [
  { name: "Asana", logo: "/linkify/assets/company-01.svg" },
  { name: "Tidal", logo: "/linkify/assets/company-02.svg" },
  { name: "Innovaccer", logo: "/linkify/assets/company-03.svg" },
  { name: "Linear", logo: "/linkify/assets/company-04.svg" },
  { name: "Raycast", logo: "/linkify/assets/company-05.svg" },
  { name: "Labelbox", logo: "/linkify/assets/company-06.svg" },
];

const featureCards = [
  {
    icon: Link2Icon,
    name: "Shorten links",
    description: "Create short links that are easy to remember and share.",
    className: "lg:col-span-1",
    background: <ShortenLinksCard />,
  },
  {
    icon: SearchIcon,
    name: "Search your links",
    description: "Quickly find the links you need with AI-powered search.",
    className: "lg:col-span-2",
    background: <SearchLinksCard />,
  },
  {
    icon: WaypointsIcon,
    name: "Connect your apps",
    description: "Integrate with your favorite apps and services.",
    className: "lg:col-span-2",
    background: <IntegrationsCard />,
  },
  {
    icon: CalendarIcon,
    name: "Calendar",
    description: "Keep track of your links with our calendar view.",
    className: "lg:col-span-1",
    background: <CalendarCard />,
  },
];

const process = [
  {
    title: "Organize Your Links",
    description:
      "Efficiently categorize and tag your links for quick access and easy management.",
    icon: FolderOpenIcon,
  },
  {
    title: "Shorten and Customize",
    description: "Create concise, branded links that are easy to share and track.",
    icon: WandSparklesIcon,
  },
  {
    title: "Analyze and Optimize",
    description:
      "Gain insights into link performance and optimize for better engagement.",
    icon: BarChart3Icon,
  },
];

const plans = [
  {
    name: "Free",
    info: "For most individuals",
    price: 0,
    features: [
      "Shorten links",
      "Up to 100 tags",
      "Customizable branded links",
      "Track clicks",
      "Community support",
      "AI powered suggestions",
    ],
    button: "Start for free",
  },
  {
    name: "Pro",
    info: "For small businesses",
    price: 9,
    featured: true,
    features: [
      "Shorten links",
      "Up to 500 tags",
      "Customizable branded links",
      "Track clicks",
      "Export click data",
      "Priority support",
      "AI powered suggestions",
    ],
    button: "Get started",
  },
  {
    name: "Business",
    info: "For large organizations",
    price: 49,
    features: [
      "Shorten links",
      "Unlimited tags",
      "Customizable branded links",
      "Track clicks",
      "Export click data",
      "Dedicated manager",
      "AI powered suggestions",
    ],
    button: "Contact team",
  },
];

const reviews = [
  {
    name: "Michael Smith",
    username: "@michaelsmith",
    rating: 5,
    review:
      "This tool is a lifesaver! Managing and tracking my links has never been easier. A must-have for anyone dealing with numerous links.",
  },
  {
    name: "Emily Johnson",
    username: "@emilyjohnson",
    rating: 4,
    review:
      "Very useful app! It has streamlined my workflow considerably. A few minor bugs, but overall a great experience.",
  },
  {
    name: "Daniel Williams",
    username: "@danielwilliams",
    rating: 5,
    review:
      "I've been using this app daily for months. The insights and analytics it provides are invaluable. Highly recommend it!",
  },
  {
    name: "Sophia Brown",
    username: "@sophiabrown",
    rating: 4,
    review:
      "This app is fantastic! It offers everything I need to manage my links efficiently.",
  },
  {
    name: "James Taylor",
    username: "@jamestaylor",
    rating: 5,
    review:
      "Absolutely love this app! It's intuitive and feature-rich. Has significantly improved how I manage and track links.",
  },
  {
    name: "Olivia Martinez",
    username: "@oliviamartinez",
    rating: 4,
    review:
      "Great app with a lot of potential. It has already saved me a lot of time. Looking forward to future updates and improvements.",
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
              Manage links smarter
              <ArrowRightIcon className="ml-1 size-3 transition-transform duration-300 group-hover:translate-x-0.5" />
            </SparkBadge>
            <h1 className="w-full max-w-5xl py-6 text-balance text-center text-5xl font-medium leading-[1.08] tracking-normal text-white sm:text-6xl md:text-7xl lg:text-8xl">
              Smart Links with{" "}
              <span className="inline-block bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">
                Precision
              </span>
            </h1>
            <p className="mb-12 max-w-2xl text-balance text-lg leading-8 text-white/58 md:text-xl">
              Effortlessly streamline your link management with Linkify.
              <span className="hidden md:inline">
                {" "}
                Shorten, track, and organize all your links in one place.
              </span>
            </p>
            <div className="z-10 flex items-center justify-center gap-4 whitespace-nowrap">
              <Link
                href="/signup"
                className={cn(
                  buttonVariants({ size: "lg" }),
                  "h-11 rounded-[8px] bg-white px-5 text-sm font-semibold text-black hover:bg-violet-100",
                )}
              >
                Start creating for free
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
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
                <Image
                  src="/linkify/assets/dashboard-dark.svg"
                  alt="Linkify dashboard"
                  width={1920}
                  height={1080}
                  priority
                  className="h-auto w-full"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#050505] to-transparent" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <MaxWidthSection>
        <div className="py-14">
          <h2 className="text-center text-sm font-medium uppercase tracking-[0.14em] text-white/42">
            Trusted by the best in the industry
          </h2>
          <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-10 gap-y-6 md:gap-x-16">
            {companies.map((company) => (
              <li key={company.name}>
                <Image
                  src={company.logo}
                  alt={company.name}
                  width={120}
                  height={40}
                  className="h-8 w-auto opacity-80 brightness-0 invert transition-opacity hover:opacity-100"
                />
              </li>
            ))}
          </ul>
        </div>
      </MaxWidthSection>

      <MaxWidthSection id="features" className="pt-10">
        <SectionHeader
          badge="Features"
          title="Manage Links Like a Pro"
          text="Linkify is a powerful link management tool that helps you shorten, track, and organize all your links in one place."
        />
        <div className="grid auto-rows-[22rem] grid-cols-1 gap-4 py-8 lg:grid-cols-3">
          {featureCards.map((feature) => {
            const Icon = feature.icon;
            return (
              <BentoCard key={feature.name} className={feature.className}>
                {feature.background}
                <div className="pointer-events-none relative z-10 mt-auto flex flex-col gap-1 p-6 transition-all duration-300 group-hover:-translate-y-10">
                  <Icon className="size-11 origin-left text-neutral-700 transition-all duration-300 group-hover:scale-75" />
                  <h3 className="text-xl font-semibold text-neutral-300">
                    {feature.name}
                  </h3>
                  <p className="max-w-lg text-sm leading-6 text-neutral-400">
                    {feature.description}
                  </p>
                </div>
                <div className="absolute bottom-0 flex w-full translate-y-10 items-center p-4 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
                  <a
                    href="#features"
                    className="inline-flex items-center text-sm font-semibold text-violet-200"
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
          badge="The Process"
          title="Effortless link management in 3 steps"
          text="Follow these simple steps to optimize, organize, and share your links with ease."
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

      <MaxWidthSection id="pricing" className="py-10">
        <SectionHeader
          badge="Simple Pricing"
          title="Choose a plan that works for you"
          text="Get started with Linkify today and enjoy more features with our pro plans."
        />
        <div className="grid gap-4 py-8 lg:grid-cols-3">
          {plans.map((plan) => (
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
              <div className="mt-1 text-sm text-white/42">{plan.info}</div>
              <div className="mt-5 flex items-end gap-1">
                <span className="text-4xl font-semibold">${plan.price}</span>
                <span className="pb-1 text-sm text-white/45">/month</span>
              </div>
              <Link
                href="/signup"
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
          <span>No credit card required</span>
        </div>
      </MaxWidthSection>

      <MaxWidthSection id="reviews" className="py-10">
        <SectionHeader
          badge="Our Customers"
          title="What our users are saying"
          text="Here's what some of our users have to say about Linkify."
        />
        <div className="grid grid-cols-1 gap-4 py-10 md:grid-cols-2 md:gap-8 lg:grid-cols-3">
          {reviews.map((review) => (
            <MagicCard key={`${review.name}-${review.username}`} className="p-0">
              <article className="flex h-full flex-col p-6">
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white">
                    {review.name
                      .split(" ")
                      .map((part) => part[0])
                      .join("")}
                  </div>
                  <div>
                    <h3 className="text-base font-medium text-white/76">
                      {review.name}
                    </h3>
                    <p className="text-sm text-white/42">{review.username}</p>
                  </div>
                </div>
                <p className="mt-5 text-sm leading-6 text-white/56">
                  {review.review}
                </p>
                <div className="mt-auto flex gap-1 pt-6">
                  {Array.from({ length: review.rating }, (_, index) => (
                    <StarIcon
                      key={index}
                      className="size-4 fill-[#f5a524] text-[#f5a524]"
                    />
                  ))}
                </div>
              </article>
            </MagicCard>
          ))}
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
              src="/linkify/icons/logo.svg"
              alt=""
              aria-hidden="true"
              width={32}
              height={32}
              className="size-8"
            />
            <span className="text-lg font-bold leading-none">Linkify</span>
          </Link>
          <nav className="hidden items-center gap-7 text-sm text-white/58 lg:flex">
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
            href="/signup"
            className={cn(
              buttonVariants({ size: "sm" }),
              "h-9 rounded-[8px] bg-white px-4 text-xs font-semibold text-black hover:bg-violet-100",
            )}
          >
            Get started
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

function ShortenLinksCard() {
  return (
    <div className="absolute left-10 top-10 w-[78%] origin-top rounded-md border border-white/10 bg-[#050505] p-4 transition-all duration-300 [mask-image:linear-gradient(to_top,transparent_0%,#000_100%)] group-hover:scale-105">
      <div className="text-base font-medium text-white">Create short links</div>
      <p className="mt-1 text-sm leading-6 text-white/44">
        Create short links that are easy to remember and share.
      </p>
      <label className="mt-4 block text-sm text-white/58">Paste your link</label>
      <div className="mt-2 rounded-[8px] border border-white/10 bg-white/[0.045] px-3 py-2 text-sm text-white/36">
        Paste your link here...
      </div>
    </div>
  );
}

function SearchLinksCard() {
  return (
    <div className="absolute right-10 top-10 w-[70%] origin-top border border-white/10 bg-[#050505] p-3 transition-all duration-300 [mask-image:linear-gradient(to_top,transparent_40%,#000_100%)] group-hover:-translate-x-10">
      <div className="rounded-[7px] border border-white/10 bg-white/[0.045] px-3 py-2 text-sm text-white/46">
        Type to search...
      </div>
      <div className="mt-2 space-y-1 text-sm text-white/54">
        {[
          "linkify.io/hdf00c",
          "linkify.io/sdv0n0",
          "linkify.io/03gndo",
          "linkify.io/09vmmw",
          "linkify.io/s09vws",
          "linkify.io/sd8fv5",
        ].map((item) => (
          <div key={item} className="rounded-md px-3 py-2 hover:bg-white/8">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function IntegrationsCard() {
  const names = ["Slack", "Notion", "GitHub", "Linear", "Raycast", "Stripe"];

  return (
    <div className="absolute right-2 top-4 grid h-[300px] w-[600px] grid-cols-3 gap-3 border-none pl-28 transition-all duration-300 [mask-image:linear-gradient(to_top,transparent_10%,#000_100%)] group-hover:scale-105 md:pl-0">
      {names.map((name) => (
        <div
          key={name}
          className="flex h-20 items-center justify-center rounded-[10px] border border-white/10 bg-white/[0.045] text-sm font-semibold text-white/62"
        >
          {name}
        </div>
      ))}
    </div>
  );
}

function CalendarCard() {
  return (
    <div className="absolute right-0 top-10 w-[86%] origin-top rounded-md border border-white/10 bg-[#050505] p-4 transition-all duration-300 [mask-image:linear-gradient(to_top,transparent_40%,#000_100%)] group-hover:scale-105">
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-white/38">
        {["S", "M", "T", "W", "T", "F", "S"].map((day, index) => (
          <div key={`${day}-${index}`} className="pb-2">
            {day}
          </div>
        ))}
        {Array.from({ length: 35 }, (_, index) => (
          <div
            key={index}
            className={cn(
              "flex aspect-square items-center justify-center rounded-[4px] border border-white/8",
              index === 17 && "bg-violet-500/70 text-white",
              index === 19 && "bg-fuchsia-500/40 text-white",
            )}
          >
            {index + 1 <= 31 ? index + 1 : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function LampSection() {
  return (
    <div className="relative flex w-full flex-col items-center justify-center overflow-hidden rounded-[14px] border border-white/10 bg-[radial-gradient(42%_180px_at_50%_0%,rgba(139,92,246,0.34),transparent),#08080a] px-6 py-20 text-center">
      <div className="absolute top-0 h-px w-3/4 bg-gradient-to-r from-transparent via-violet-300 to-transparent" />
      <h2 className="mt-8 bg-gradient-to-b from-neutral-200 to-neutral-400 bg-clip-text py-4 text-center text-4xl font-medium leading-[1.15] tracking-normal text-transparent md:text-7xl">
        Step into the future of link management
      </h2>
      <p className="mx-auto mt-6 max-w-md text-white/54">
        Experience the cutting-edge solution that transforms how you handle your
        links. Elevate your online presence with our next-gen platform.
      </p>
      <div className="mt-6">
        <Link
          href="/signup"
          className={cn(
            buttonVariants({ size: "lg" }),
            "h-11 rounded-[8px] bg-white px-5 text-sm font-semibold text-black hover:bg-violet-100",
          )}
        >
          Get started for free
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
            src="/linkify/icons/logo.svg"
            alt=""
            aria-hidden="true"
            width={28}
            height={28}
            className="size-7"
          />
          <span className="text-lg font-bold">Linkify</span>
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
        LINKIFY
      </div>
    </footer>
  );
}
