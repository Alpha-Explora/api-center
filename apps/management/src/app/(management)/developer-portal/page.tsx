import { DeveloperPortalPreview } from "@/components/developer-portal-preview";
import { PageHeading } from "@/components/page-heading";

export default async function DeveloperPortalPage({
  searchParams,
}: {
  searchParams?: Promise<{ tribeId?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Developer portal"
        description="Preview the read-only tribe portal packet without exposing runtime credentials."
      />
      <DeveloperPortalPreview initialTribeId={params?.tribeId?.trim() ?? ""} />
    </div>
  );
}
