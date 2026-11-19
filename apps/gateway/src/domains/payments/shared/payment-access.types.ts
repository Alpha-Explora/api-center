/**
 * The application a payment call acts for, from its key's control-plane grants. Payment
 * resources are owned by the organization (`ownerTribeId` internally) and project.
 */
export type PaymentPrincipal = {
  ownerTribeId: string;
  projectId: string;
  /** The application ID. */
  consumerServiceId: string;
  environment: "test" | "live";
};
