import { merchantBindingSchema } from "../model/payments-merchant";
import { call, org } from "./http";

/** Whether the organization may use payments at all. Any member can read it. */
export const paymentsMerchant = {
  binding: (organizationId: string) => call(merchantBindingSchema, `${org(organizationId)}/payments/merchant-binding`),
};

export const paymentsMerchantKey = (organizationId: string) => ["cp", organizationId, "payments-merchant"] as const;
