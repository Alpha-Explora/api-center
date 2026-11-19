import { Suspense } from "react";
import { ApplicationPage } from "@/features/control-plane/views/applications/application-page";

export default async function Page({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params;
  return (
    <Suspense>
      <ApplicationPage applicationId={decodeURIComponent(applicationId)} />
    </Suspense>
  );
}
