import { ConsumerRunbookActions } from "@/components/consumer-runbook-actions";
import { PageHeading } from "@/components/page-heading";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const runbookSections = [
  {
    title: "Developer and Management guides",
    description: "Use the docs app for service registration, SDK setup, authentication, shared-service APIs, payments, and event handling.",
    href: "https://api-center.itsandbox.site/docs",
    action: "Open APICenter docs",
  },
  {
    title: "Confirm service registration",
    description: "Check the organization, tribe, project, service ID, environment, allowed shared services, and required scopes in Registry before integrating.",
  },
  {
    title: "Store server credentials",
    description: "Provision the secret hash in APICenter, then copy the plaintext service secret into the backend secret manager. Keep credentials separate per service and environment; never expose them to a browser.",
  },
  {
    title: "Configure payment events",
    description: "If the service consumes payment events, ask an APICenter operator to configure its Pub/Sub push subscription and OIDC identity. Use the Event delivery guide in the developer docs to deduplicate and order updates.",
    href: "https://api-center.itsandbox.site/docs",
    action: "Open developer docs",
  },
];

export default function ConsumerRunbookPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading title="Consumer runbook" description="Prepare a registered backend to call APICenter shared APIs and process payment events." />
      <ConsumerRunbookActions />
      <div className="grid gap-4 md:grid-cols-2">
        {runbookSections.map((section) => (
          <Card key={section.title}>
            <CardHeader><CardTitle>{section.title}</CardTitle><CardDescription>{section.description}</CardDescription></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {section.href ? <a className="font-semibold text-primary underline" href={section.href} target="_blank" rel="noreferrer">{section.action}</a> : "Use the Registry and service detail page to confirm this step."}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
