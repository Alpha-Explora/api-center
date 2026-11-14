import { ProjectView } from "@/features/control-plane/views/project-view";

export default async function ControlPlaneProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectView projectId={projectId} />;
}
