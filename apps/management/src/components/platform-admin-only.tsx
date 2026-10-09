"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getManagementSession } from "@/lib/api-center-client";
import { queryKeys } from "@/lib/query-keys";

export function PlatformAdminOnly({ children }: { children: ReactNode }) {
  const session = useQuery({
    queryKey: queryKeys.managementSession,
    queryFn: getManagementSession,
    staleTime: 60_000,
  });

  if (session.isLoading) {
    return <p className="text-sm text-muted-foreground">Checking platform access…</p>;
  }
  if (!session.data?.platformAdmin) {
    return <p role="alert" className="text-sm text-muted-foreground">This page is available to platform administrators.</p>;
  }
  return children;
}
