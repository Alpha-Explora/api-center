// APICenter's payment provider account belongs to the installing organization. Under the payment
// ADRs, another organization may neither select nor inherit that merchant binding, and there is no
// platform-wide fallback merchant. Payments are available only to organizations listed in
// PAYMENTS_MERCHANT_ORGANIZATION_IDS (the internal bootstrap organization).

import { AppError } from "@shared/errors";

export function merchantOrganizationIds(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.PAYMENTS_MERCHANT_ORGANIZATION_IDS ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
}

export function assertMerchantBinding(organizationId: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!merchantOrganizationIds(env).includes(organizationId.toLowerCase())) {
    throw new AppError(
      "Payments need an approved merchant binding for this organization; none is configured",
      403,
      "PAYMENTS_MERCHANT_NOT_BOUND",
    );
  }
}
