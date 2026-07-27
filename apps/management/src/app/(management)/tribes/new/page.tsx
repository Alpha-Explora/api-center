import { TribeForm } from "@/components/tribe-form";
import { PageHeading } from "@/components/page-heading";

export default function NewTribePage() {
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeading
        title="Register service"
        description="Register a service manifest with its backend API URL, exposed routes, required scopes, and allowed dependencies."
      />
      <TribeForm />
    </div>
  );
}
