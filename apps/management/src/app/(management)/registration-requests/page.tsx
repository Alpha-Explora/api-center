import { PageHeading } from "@/components/page-heading";
import { RegistrationRequestsClient } from "@/components/registration-requests-client";

export default function RegistrationRequestsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Registration requests"
        description="Review manifest submissions before they become active APICenter registry entries."
      />
      <RegistrationRequestsClient />
    </div>
  );
}
