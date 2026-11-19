import type { Metadata } from "next";
import { ProjectProvider } from "@/features/control-plane/view-models/project-environment";
import { ProjectSettingsPage } from "@/features/control-plane/views/settings/project-settings-page";

export const metadata: Metadata = { title: "Project settings" };

/** Project-level, so it sits beside [env] rather than under it and loads the project itself. */
export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return (
    <ProjectProvider projectId={decodeURIComponent(projectId)}>
      <ProjectSettingsPage />
    </ProjectProvider>
  );
}
