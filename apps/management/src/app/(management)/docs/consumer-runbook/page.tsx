import { ConsumerRunbookActions } from "@/components/consumer-runbook-actions";
import { PageHeading } from "@/components/page-heading";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const runbookSections = [
  {
    title: "API Center endpoint",
    description:
      "Use the test API Center endpoint from the portal packet while onboarding. Move to the live endpoint only after readiness and quota review are complete.",
  },
  {
    title: "SDK setup",
    description:
      "Install @implementsprint/sdk, configure the tribe service ID, and keep runtime credentials in the service environment rather than browser bundles.",
  },
  {
    title: "Allowed services",
    description:
      "Call only shared services listed in the portal packet. Missing services should be requested through registry or quota review before use.",
  },
  {
    title: "Event topics",
    description:
      "Publish events to the tribe topic prefix shown in the portal packet so ingestion, audit, and data quality checks can trace ownership.",
  },
];

export default function ConsumerRunbookPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="SDK runbook"
        description="Consumer setup guidance for the Developer Portal onboarding packet."
      />
      <ConsumerRunbookActions />
      <div className="grid gap-4 md:grid-cols-2">
        {runbookSections.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Keep this step complete before moving the tribe packet to live
              readiness review.
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
