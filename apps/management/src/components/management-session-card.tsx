"use client";

import { useQuery } from "@tanstack/react-query";
import { getManagementSession } from "@/lib/api-center-client";
import { getManagementActionAvailability } from "@/lib/action-capabilities";
import { queryKeys } from "@/lib/query-keys";
import type { ManagementEnvironment } from "@/lib/server/management-auth";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ManagementSessionCard({
  environment,
}: {
  environment: ManagementEnvironment;
}) {
  const sessionQuery = useQuery({
    queryKey: queryKeys.managementSession,
    queryFn: getManagementSession,
    staleTime: 60_000,
  });

  if (sessionQuery.isLoading) {
    return <Skeleton className="h-52 w-full" />;
  }

  if (sessionQuery.isError || !sessionQuery.data) {
    return (
      <Card className="border-destructive/30 bg-[#fff7f7]">
        <CardHeader>
          <CardTitle>Management session</CardTitle>
          <CardDescription>
            The current management session could not be verified.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const session = sessionQuery.data;
  const availability = getManagementActionAvailability({
    role: session.role,
    environment,
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Management session</CardTitle>
            <CardDescription>
              Resolved identity and management action availability.
            </CardDescription>
          </div>
          <Badge variant={session.role === "admin" ? "default" : "outline"}>
            {formatSessionAccess(session.role)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 text-sm sm:grid-cols-3">
          <SessionDetail label="Email" value={session.email} />
          <SessionDetail label="Source" value={session.source} />
          <SessionDetail label="User ID" value={session.userId} />
        </div>
        <div className="grid gap-2 text-sm md:grid-cols-2">
          {availability.map((item) => (
            <div
              key={item.actionId}
              className="flex items-start justify-between gap-3 rounded-lg border bg-card p-3"
            >
              <div className="min-w-0">
                <div className="font-medium">{item.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {item.risk}
                  {item.confirmationRequired ? " · confirmation" : ""}
                  {item.reasonRequired ? " · reason" : ""}
                </div>
              </div>
              <Badge
                variant={item.allowed ? "secondary" : "destructive"}
                className="shrink-0"
              >
                {item.allowed ? "allowed" : "blocked"}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function formatSessionAccess(role: string) {
  if (role === "admin") return "full access";
  if (role === "operator") return "change access";
  if (role === "observer") return "read access";
  return role;
}

function SessionDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border bg-card p-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all font-mono text-[13px] font-medium leading-5">
        {value}
      </span>
    </div>
  );
}
