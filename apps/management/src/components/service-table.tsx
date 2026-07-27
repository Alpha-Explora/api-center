import { StatusBadge } from "@/components/status-badge";
import { getServiceEventTopics } from "@/lib/event-topics";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ServiceRegistryEntry } from "@/lib/schemas";

export function ServiceTable({
  services,
  title = "Registry services",
  description = "Services currently known by API Center.",
}: {
  services: ServiceRegistryEntry[];
  title?: string;
  description?: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Backend URL</TableHead>
              <TableHead>Event topic</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.map((service) => (
              <TableRow key={service.serviceId}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{service.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {service.serviceId}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="max-w-80 truncate">
                  {service.baseUrl}
                </TableCell>
                <TableCell className="max-w-72 truncate">
                  {
                    getServiceEventTopics({
                      serviceId: service.serviceId,
                      ownerTribeId: service.ownerTribeId,
                      serviceType:
                        service.serviceType === "shared" ? "shared" : "tribe",
                    }).primary
                  }
                </TableCell>
                <TableCell>{service.serviceType ?? "tribe"}</TableCell>
                <TableCell>
                  <StatusBadge status={service.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
