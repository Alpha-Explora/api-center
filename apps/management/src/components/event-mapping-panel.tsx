import type { ServiceRegistryEntry } from "@/lib/schemas";
import { getServiceEventTopics } from "@/lib/event-topics";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function EventMappingPanel({
  service,
}: {
  service: ServiceRegistryEntry;
}) {
  const serviceType = service.serviceType === "shared" ? "shared" : "tribe";
  const topics = getServiceEventTopics({
    serviceId: service.serviceId,
    ownerTribeId: service.ownerTribeId,
    serviceType,
  });
  const isSharedService = serviceType === "shared";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event and S3 mapping</CardTitle>
        <CardDescription>
          Expected Confluent topics for gateway and tribe data.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-3 text-sm md:grid-cols-2">
          <Topic label={topics.primaryLabel} value={topics.primary} />
          {isSharedService ? (
            <Topic label="Tribe events" value={topics.tribeEvents} />
          ) : null}
          <Topic label="Gateway request" value={topics.request} />
          <Topic label="Gateway response" value={topics.response} />
          <Topic label="Audit" value={topics.audit} />
        </dl>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border p-3 text-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-medium">Confluent topic check</span>
              <Badge variant="outline">provisionable</Badge>
            </div>
            <p className="text-muted-foreground">
              {isSharedService
                ? "Use the Confluent provisioning card on shared services to create the sanitized shared-service export topic. Gateway and audit topics are platform topics."
                : "Use the Confluent provisioning card on tribe services to create the tribe event topic. Gateway and audit topics are platform topics."}
            </p>
          </div>
          <div className="rounded-lg border p-3 text-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="font-medium">S3 sink coverage</span>
              <Badge variant="outline">connector-managed</Badge>
            </div>
            <p className="text-muted-foreground">
              Add the primary event topic to the managed Confluent S3 sink
              before expecting records in the raw data lake.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Topic({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all font-medium">{value}</dd>
    </div>
  );
}
