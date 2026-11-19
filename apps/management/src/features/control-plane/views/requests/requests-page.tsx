"use client";
import { PageHeader } from "@/components/patterns/page-header";
import { RequireEnvironment, useProjectEnvironment } from "../../view-models/project-environment";
import { RequestLogPanel } from "./request-log-panel";

export function RequestsPage() {
  return (
    <RequireEnvironment>
      <Requests />
    </RequireEnvironment>
  );
}

function Requests() {
  const { project, kind } = useProjectEnvironment();
  return (
    <>
      <PageHeader title="Requests" description={`Requests that ${project.name}'s ${kind} applications made through the gateway. Select one for its details.`} />
      <RequestLogPanel />
    </>
  );
}
