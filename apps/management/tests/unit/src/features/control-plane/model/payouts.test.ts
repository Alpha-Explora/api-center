import { describe, expect, it } from "vitest";
import {
  availabilityMessage,
  describeDestination,
  describeSchedule,
  formatCentavos,
  parsePesos,
  payeeSchema,
  payoutOverviewSchema,
} from "@/features/control-plane/model/payouts";

describe("payout model", () => {
  it("formats centavos as pesos", () => {
    expect(formatCentavos(72_500)).toBe("₱725.00");
    expect(formatCentavos(1_250_000)).toBe("₱12,500.00");
    expect(formatCentavos(-8_500)).toBe("-₱85.00");
  });

  it("reads pesos typed into a form", () => {
    expect(parsePesos("100")).toBe(10_000);
    expect(parsePesos("10,000.50")).toBe(1_000_050);
    expect(parsePesos("1.234")).toBeUndefined();
    expect(parsePesos("-5")).toBeUndefined();
  });

  it("describes destinations and schedules for people", () => {
    expect(describeDestination({ type: "instapay", bic: "GXCHPHM2XXX", accountName: "Juan", accountNumberLast4: "4567" })).toBe("GCash •••• 4567");
    expect(describeDestination({ type: "wallet", accountName: "Juan", accountNumberLast4: "9999" })).toBe("Wallet •••• 9999");
    expect(describeDestination({ type: "provider_wallet", accountName: "Juan", accountNumberLast4: "9999" })).toBe("Wallet •••• 9999");
    expect(describeDestination(null)).toBe("Not set");
    expect(describeSchedule({ weekday: 5, hour: 20 })).toBe("Friday 8:00 PM");
    expect(describeSchedule({ weekday: 1, hour: 0 })).toBe("Monday 12:00 AM");
    expect(describeSchedule(null)).toBe("No weekly payout");
  });

  it("explains features that are not available yet", () => {
    expect(availabilityMessage("transfers", { available: true, reason: null })).toBeNull();
    expect(availabilityMessage("transfers", { available: false, reason: "not_enabled" })).toMatch(/not available in live yet\. Try it in test/);
    expect(availabilityMessage("transfers", { available: false, reason: "wallet_not_configured" })).toMatch(/payout wallet/);
    expect(availabilityMessage("payeeWallets", { available: false, reason: "test_only" })).toMatch(/not available in live yet/);
    expect(availabilityMessage("payeeWallets", { available: false, reason: "provider_unavailable" })).toMatch(/local mock mode/);
    expect(availabilityMessage("linkedAccounts", { available: false, reason: "not_enabled" })).toMatch(/not available in live yet/);
  });

  it("assumes a runtime that predates availability can send payouts but has nothing unreleased", () => {
    const overview = payoutOverviewSchema.parse({ wallet: { configured: true, available: 0, lowFloatAlert: 0 }, counts: {}, needsReview: [], nextScheduledAt: null });
    expect(overview.availability.transfers.available).toBe(true);
    expect(overview.availability.linkedAccounts.available).toBe(false);
  });

  it("refuses a payee whose destination is not masked", () => {
    const payee = { id: "pye_1", externalRef: "ext-1", legalName: "Juan", status: "active", destinationHoldUntil: null, createdAt: "2026-11-24T00:00:00Z" };
    expect(payeeSchema.safeParse({ ...payee, destination: { type: "instapay", accountName: "Juan", accountNumber: "09171234567" } }).success).toBe(false);
    expect(payeeSchema.safeParse({ ...payee, destination: { accountName: "Juan", accountNumberLast4: "4567" } }).success).toBe(false);
    expect(payeeSchema.safeParse({ ...payee, destination: null }).success).toBe(true);
  });

  it("parses the overview the gateway returns", () => {
    expect(payoutOverviewSchema.parse({ wallet: { configured: false, available: null, lowFloatAlert: 0 }, counts: { paid: 2 },
      needsReview: [], nextScheduledAt: null }).wallet.configured).toBe(false);
  });
});
