"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { ErrorPanel } from "@/components/patterns/notices";
import { DescriptionList, Panel } from "@/components/patterns/panel";
import { useOrganization } from "@/features/control-plane/view-models/use-organization";

/** Who is signed in, how, and in which organizations. */
export function SessionPanel() {
  const { session, loading, organizations } = useOrganization();
  if (loading) return <Skeleton className="h-36 w-full" />;
  if (!session) return <ErrorPanel title="Your session could not be verified" error="Sign in again." />;
  return (
    <Panel title="Your session">
      <DescriptionList
        items={[
          { label: "Email", value: session.email },
          { label: "Sign-in", value: session.source === "google" ? "Google" : "Local development" },
          { label: "Platform operator", value: session.platformAdmin ? "Yes" : "No" },
          {
            label: "Organizations",
            value: organizations.length ? organizations.map((entry) => entry.name).join(", ") : "None (platform operators act in any organization)",
          },
          { label: "User ID", value: <span className="font-mono text-xs">{session.userId}</span> },
        ]}
      />
    </Panel>
  );
}
