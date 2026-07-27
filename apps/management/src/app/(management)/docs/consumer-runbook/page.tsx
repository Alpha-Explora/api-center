import { ConsumerRunbookActions } from "@/components/consumer-runbook-actions";
import { PageHeading } from "@/components/page-heading";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const runbookSections = [
  {
    title: "Canonical API documentation",
    description: "Use the APICenter developer documentation for public payment endpoints, authentication, idempotency, SDK usage, and event payloads.",
    href: "https://api-center.itsandbox.site/docs",
    action: "Open APICenter docs",
  },
  {
    title: "Operator provisioning",
    description: "Register the consumer from Payment consumers, choose the minimum scopes, provide its Cloud Run delivery identity, and verify the Pub/Sub subscription status.",
  },
  {
    title: "One-time secret handling",
    description: "Copy the generated APICenter key once into the consumer service's Secret Manager. Management never stores plaintext keys and consumers never receive PayMongo credentials.",
  },
  {
    title: "Delivery troubleshooting",
    description: "Review the delivery status, last delivery timestamp, dead-letter count, and Cloud Run invoker/OIDC configuration before retrying a failed subscription.",
  },
];

export default function ConsumerRunbookPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading title="Consumer runbook" description="Operator setup and security guidance for APICenter consumers." />
      <ConsumerRunbookActions />
      <div className="grid gap-4 md:grid-cols-2">
        {runbookSections.map((section) => (
          <Card key={section.title}>
            <CardHeader><CardTitle>{section.title}</CardTitle><CardDescription>{section.description}</CardDescription></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {section.href ? <a className="font-semibold text-primary underline" href={section.href} target="_blank" rel="noreferrer">{section.action}</a> : "Keep this step complete before live readiness review."}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}