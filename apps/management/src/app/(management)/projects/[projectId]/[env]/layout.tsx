import { notFound } from "next/navigation";
import { ProjectEnvironmentProvider } from "@/features/control-plane/view-models/project-environment";

export default async function ProjectEnvironmentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string; env: string }>;
}) {
  const { projectId, env } = await params;
  if (env !== "test" && env !== "live") notFound();
  return (
    <ProjectEnvironmentProvider projectId={decodeURIComponent(projectId)} kind={env}>
      {children}
    </ProjectEnvironmentProvider>
  );
}
