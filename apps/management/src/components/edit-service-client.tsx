"use client";

import { useQuery } from "@tanstack/react-query";
import { getService } from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";
import { TribeForm } from "@/components/tribe-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export function EditServiceClient({ serviceId }: { serviceId: string }) {
  const serviceQuery = useQuery({
    queryKey: queryKeys.service(serviceId),
    queryFn: () => getService(serviceId),
  });

  if (serviceQuery.isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (serviceQuery.isError || !serviceQuery.data) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Could not load service</AlertTitle>
        <AlertDescription>
          Check that the service exists and the platform secret is
          configured.
        </AlertDescription>
      </Alert>
    );
  }

  return <TribeForm initialValue={serviceQuery.data} mode="edit" />;
}
