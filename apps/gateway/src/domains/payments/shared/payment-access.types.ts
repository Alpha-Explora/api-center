export interface PaymentAccessDirectory {
  hasActiveReadWriteKey(serviceId: string, projectId: string, environment: "test" | "live"): Promise<boolean | null>;
}

export const PAYMENT_ACCESS_DIRECTORY = Symbol("PAYMENT_ACCESS_DIRECTORY");
