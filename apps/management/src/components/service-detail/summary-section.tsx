import { Detail } from "@/components/service-detail/detail";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ServiceRegistryEntry } from "@/lib/schemas";

export function StatusSummaryCard({
  service,
  brokenDependencyCount,
  consumerCount,
}: {
  service: ServiceRegistryEntry;
  brokenDependencyCount: number;
  consumerCount: number;
}) {
  const currentIssue =
    service.status !== "active"
      ? `${service.name} is ${service.status}.`
      : brokenDependencyCount > 0
        ? `${service.name} has unresolved dependency references.`
        : "No blocking issue is currently selected for this service.";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Priority signal</CardTitle>
        <CardDescription>
          Strongest service signal based on registry posture.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-sm md:grid-cols-3">
          <Detail label="Issue" value={currentIssue} />
          <Detail label="Status" value={service.status} />
          <Detail label="Consumers" value={String(consumerCount)} />
        </dl>
      </CardContent>
    </Card>
  );
}
