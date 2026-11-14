export interface PaymentConsumerRegistrationDirectory {
  list(organizationIds?: string[]): Promise<Array<Record<string, unknown>>>;
}

export const PAYMENT_CONSUMER_REGISTRATION_DIRECTORY = Symbol(
  "PAYMENT_CONSUMER_REGISTRATION_DIRECTORY",
);

export interface PaymentCredentialEvidenceDirectory {
  credentialVersions(serviceId: string, environment: "test" | "live"): Promise<Array<{ id: string; expires_at: Date | null; revoked_at: Date | null; event_endpoint_url: string | null }>>;
}
export const PAYMENT_CREDENTIAL_EVIDENCE_DIRECTORY = Symbol("PAYMENT_CREDENTIAL_EVIDENCE_DIRECTORY");
