import { Suspense } from "react";
import type { Metadata } from "next";
import { ProjectsPage } from "@/features/control-plane/views/projects/projects-page";

export const metadata: Metadata = { title: "Projects" };

export default function Page() {
  return (
    <Suspense>
      <ProjectsPage />
    </Suspense>
  );
}
