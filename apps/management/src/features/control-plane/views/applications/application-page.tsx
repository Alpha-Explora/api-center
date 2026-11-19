"use client";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { IdText } from "@/components/patterns/copy-button";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorPanel } from "@/components/patterns/notices";
import { PageHeader } from "@/components/patterns/page-header";
import { StatusBadge } from "@/components/patterns/status-badge";
import { controlPlane } from "../../data/control-plane-repository";
import type { Application } from "../../model/control-plane";
import { PageSkeleton, RequireEnvironment, useProjectEnvironment } from "../../view-models/project-environment";
import { cpKeys } from "../../view-models/query-keys";
import { AccessTab } from "./access-tab";
import { KeysTab } from "./keys-tab";

/** The application's tabs, in order. Each feature that attaches something to an application adds one here. */
const TABS: { id: string; label: string; render: (application: Application) => ReactNode }[] = [
  { id: "access", label: "Access", render: (application) => <AccessTab application={application} /> },
  { id: "keys", label: "Keys", render: (application) => <KeysTab application={application} /> },
];

export function ApplicationPage({ applicationId }: { applicationId: string }) {
  return (
    <RequireEnvironment>
      <ApplicationDetail applicationId={applicationId} />
    </RequireEnvironment>
  );
}

function ApplicationDetail({ applicationId }: { applicationId: string }) {
  const { organizationId, project, kind } = useProjectEnvironment();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const applications = useQuery({
    queryKey: cpKeys.applications(organizationId, project.id, kind),
    queryFn: () => controlPlane.applications(organizationId, project.id, kind),
    retry: false,
  });
  const tab = TABS.some((entry) => entry.id === searchParams.get("tab")) ? (searchParams.get("tab") as string) : TABS[0].id;

  if (applications.error) return <ErrorPanel title="The application could not be loaded" error={applications.error} />;
  if (!applications.data) return <PageSkeleton />;
  const application = applications.data.find((entry) => entry.id === applicationId);
  if (!application) {
    return <EmptyState title="Application not found" description={`No ${kind} application ${applicationId} in this project. Applications in test and live are separate.`} />;
  }

  return (
    <>
      <PageHeader
        title={application.name}
        meta={
          <>
            <span className="font-mono">{application.slug}</span>
            <span aria-hidden>·</span>
            <IdText value={application.id} />
          </>
        }
        actions={<StatusBadge status={application.status} />}
      />
      <Tabs value={tab} onValueChange={(value) => router.replace(`${pathname}?tab=${String(value)}`, { scroll: false })}>
        <TabsList variant="line" className="h-9 w-full justify-start gap-1 rounded-none border-b p-0">
          {TABS.map((entry) => (
            <TabsTrigger key={entry.id} value={entry.id}>
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((entry) => (
          <TabsContent key={entry.id} value={entry.id} className="mt-4 flex flex-col gap-6">
            {entry.render(application)}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}
