export interface PaymentConsumerRegistrationDirectory {
  list(organizationIds?: string[]): Promise<Array<Record<string, unknown>>>;
}

export const PAYMENT_CONSUMER_REGISTRATION_DIRECTORY = Symbol(
  "PAYMENT_CONSUMER_REGISTRATION_DIRECTORY",
);
