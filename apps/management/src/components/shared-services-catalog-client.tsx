"use client";

import Link from "next/link";
import {
  ArrowRightIcon,
  KeyRoundIcon,
  MailIcon,
  MapPinIcon,
  MessageSquareIcon,
  ShieldCheckIcon,
  WalletCardsIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { listServices } from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const sharedServices = [
  {
    id: "gauth",
    route: "/api/v1/shared/gauth",
    icon: ShieldCheckIcon,
    description: "Google OAuth callback and account identity handoff.",
    secret: "GOOGLE_CLIENT_ID",
  },
  {
    id: "geo",
    route: "/api/v1/shared/geo",
    icon: MapPinIcon,
    description: "Google Maps-backed geocoding and location lookups.",
    secret: "GOOGLE_MAPS_API_KEY",
  },
  {
    id: "payment",
    route: "/api/v1/payments",
    icon: WalletCardsIcon,
    description: "PayMongo-backed checkout, subscription, refund, and webhook handling.",
    secret: "PAYMONGO_LIVE_SECRET_KEY",
  },
  {
    id: "email",
    route: "/api/v1/shared/email",
    icon: MailIcon,
    description: "Resend-backed transactional email dispatch.",
    secret: "RESEND_API_KEY",
  },
  {
    id: "sms",
    route: "/api/v1/shared/sms",
    icon: MessageSquareIcon,
    description: "Central SMS wrapper for tribe notifications.",
    secret: "SMS_PROVIDER_API_KEY",
  },
  {
    id: "otp",
    route: "/api/v1/shared/otp",
    icon: KeyRoundIcon,
    description: "OTP issue, verify, and rate-limit workflows.",
    secret: "REDIS_URL",
  },
];

export function SharedServicesCatalogClient() {
  const servicesQuery = useQuery({
    queryKey: queryKeys.services,
    queryFn: listServices,
  });

  const registryById = new Map(
    (servicesQuery.data ?? []).map((service) => [service.serviceId, service]),
  );

  return (
    <>
      <section className="overflow-hidden rounded-xl bg-[linear-gradient(135deg,var(--hero-dark-from)_0%,var(--hero-dark-mid)_54%,var(--hero-dark-to)_100%)] text-white">
        <div className="flex flex-col gap-6 p-6 md:flex-row md:items-end md:justify-between md:p-8">
          <div className="max-w-2xl">
            <div className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-sm">
              Shared-service gateway catalog
            </div>
            <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.03em]">
              Central wrappers with registry status in one place.
            </h2>
            <p className="mt-3 text-base leading-7 text-white/72">
              Register the shared manifests, keep provider secrets in the
              shared-services Secret Manager payload, and let tribes consume
              them through API Center and the SDK.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              nativeButton={false}
              className="bg-[var(--brand-green)] text-primary hover:bg-[var(--brand-green)]/90"
              render={<Link href="/shared-services/setup" />}
            >
              Setup manifests
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
            <Button
              nativeButton={false}
              variant="outline"
              className="border-white/20 bg-white text-primary hover:bg-white/90"
              render={<Link href="/shared-services/usage" />}
            >
              View usage matrix
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sharedServices.map((service) => {
          const registered = registryById.get(service.id);

          return (
            <Card key={service.id} className="border-[var(--brand-green)]/20">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 items-center justify-center rounded-full bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]">
                      <service.icon data-icon="inline-start" />
                    </span>
                    <CardTitle className="font-mono text-base">
                      {service.id}
                    </CardTitle>
                  </div>
                  <Badge
                    variant={registered ? "secondary" : "outline"}
                    className={
                      registered
                        ? "bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]"
                        : undefined
                    }
                  >
                    {registered ? registered.status : "not registered"}
                  </Badge>
                </div>
                <CardDescription>{service.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <Signal label="SDK route" value={service.route} />
                <Signal label="Required secret signal" value={service.secret} />
                <Signal
                  label="Registry owner"
                  value={registered?.ownerTeam || "Register manifest first"}
                />
                <Signal
                  label="Health path"
                  value={registered?.healthCheck || "Register manifest first"}
                />
                <div className="flex flex-wrap gap-2 pt-1">
                  {registered ? (
                    <Button
                      nativeButton={false}
                      size="sm"
                      variant="outline"
                      render={<Link href={serviceSummaryHref(service.id)} />}
                    >
                      Open detail
                    </Button>
                  ) : null}
                  <Button
                    nativeButton={false}
                    size="sm"
                    variant={registered ? "outline" : "default"}
                    render={<Link href="/shared-services/setup" />}
                  >
                    {registered ? "Update manifest" : "Register manifest"}
                  </Button>
                  {service.id === "gauth" ? (
                    <Button
                      nativeButton={false}
                      size="sm"
                      variant="outline"
                      render={<Link href="/shared-services/google-sign-in" />}
                    >
                      Google sign-in
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function serviceSummaryHref(serviceId: string) {
  return `/tribes/${encodeURIComponent(serviceId)}?section=summary`;
}

function Signal({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 break-all font-mono text-[13px]">{value}</div>
    </div>
  );
}
