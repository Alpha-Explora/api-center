import { ApiPage } from "@/features/control-plane/views/apis/api-page";

export default async function Page({ params }: { params: Promise<{ apiId: string }> }) {
  const { apiId } = await params;
  return <ApiPage apiId={decodeURIComponent(apiId)} />;
}
