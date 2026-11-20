"use client";

import type { ReactNode } from "react";
import { ShieldIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/patterns/empty-state";
import { useOrganization } from "@/features/control-plane/view-models/use-organization";

export function PlatformAdminOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useOrganization();

  if (loading) {
    return (
      <div role="status" aria-label="Checking platform access" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (!session?.platformAdmin) {
    return (
      <div role="alert">
        <EmptyState icon={<ShieldIcon />} title="Platform operators only" description="This page is available to platform administrators." />
      </div>
    );
  }
  return children;
}

/** A section of a page that only platform operators see; everyone else sees nothing in its place. */
export function PlatformSection({ children }: { children: ReactNode }) {
  const { session } = useOrganization();
  return session?.platformAdmin ? children : null;
}
