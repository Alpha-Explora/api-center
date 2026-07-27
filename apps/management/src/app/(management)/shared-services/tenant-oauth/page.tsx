import { ClipboardCheckIcon, CloudIcon, KeyRoundIcon, ShieldCheckIcon } from "lucide-react";

import { PageHeading } from "@/components/page-heading";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const lifecycleSteps = [
  {
    title: "Create tenant shell",
    description:
      "Create the tenant folder and auth project under customer runtime, link billing, and apply APIC labels.",
    icon: CloudIcon,
  },
  {
    title: "Configure Google",
    description:
      "Use the tenant auth project to complete Google Auth Platform branding and create the Web OAuth client.",
    icon: ClipboardCheckIcon,
  },
  {
    title: "Store centrally",
    description:
      "Put the tenant client ID and one-time client secret in the central shared-services Secret Manager payload.",
    icon: KeyRoundIcon,
  },
  {
    title: "Activate routing",
    description:
      "Set the tenant status active only after authorization URL generation and token exchange are verified.",
    icon: ShieldCheckIcon,
  },
];

const checks = [
  "Tenant folder follows 20-customer-runtime/apicenter/dedicated/tenant-<slug>.",
  "Auth project ID follows ae-apic-auth-<tenant>-<environment>.",
  "Central secret entry uses GOOGLE_OAUTH_TENANT_CLIENTS_JSON.",
  "Production fallback stays disabled unless explicitly approved.",
  "Google redirect URI matches the APICenter gauth callback exactly.",
];

export default function TenantOAuthPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Tenant Google OAuth"
        description="Operator workflow for tenant-branded Google login through the gauth shared service."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {lifecycleSteps.map((step) => (
          <Card key={step.title}>
            <CardHeader>
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-[var(--brand-green-soft)] text-[var(--brand-green-deep)]">
                  <step.icon data-icon="inline-start" />
                </span>
                <CardTitle>{step.title}</CardTitle>
              </div>
              <CardDescription>{step.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activation Checks</CardTitle>
          <CardDescription>
            Keep tenant-branded login disabled until these conditions are true.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {checks.map((check) => (
              <li key={check} className="flex gap-2">
                <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-[var(--brand-green-deep)]" />
                <span>{check}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
