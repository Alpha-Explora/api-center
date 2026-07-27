import { ManifestToolsClient } from "@/components/manifest-tools-client";
import { PageHeading } from "@/components/page-heading";

export default function ManifestToolsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Manifest tools"
        description="Export registry entries or paste service manifests for local import."
      />
      <ManifestToolsClient />
    </div>
  );
}
